import app from "./worker-entry5.js";
import { supplementPaths, supplementService, json } from "./supplement-service.js";
import {ensureRetentionAlarm, tryPurgeSupplementImages, sweepSupplementImages} from './supplement-retention.js';
import {registrationNotePaths, registrationNumberNotes} from './registration-number-notes.js';

const APPROVED_RESULTS = new Set(["type1", "type2", "type3", "special"]);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/admin/review") {
      if (!env.ADMIN_KEY || request.headers.get("X-Admin-Key") !== env.ADMIN_KEY) {
        return new Response(JSON.stringify({ success: false, message: "Unauthorized." }), {
          status: 401,
          headers: { "Content-Type": "application/json; charset=UTF-8", "Cache-Control": "no-store" }
        });
      }
      let body = null;
      try { body = await request.clone().json(); } catch {}

      if (APPROVED_RESULTS.has(String(body?.result || "")) && env.REGISTRATION_ISSUER) {
        const id = env.REGISTRATION_ISSUER.idFromName("registration-number-issuer");
        const stub = env.REGISTRATION_ISSUER.get(id);
        return stub.fetch(request);
      }
    }

    return app.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") {
      return app.scheduled(controller, env, ctx);
    }
  }
};

export class RegistrationIssuer {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.tail = Promise.resolve();
  }

  fetch(request) {
    const run = this.tail.then(() => this.handle(request));
    this.tail = run.catch(() => {});
    return run;
  }

  alarm() {
    const run = this.tail.then(() => this.runRetention());
    this.tail = run.catch(() => {});
    return run;
  }

  async runRetention() {
    // Set the next attempt first, so failures and interrupted passes remain retryable.
    await this.state.storage.setAlarm(Date.now() + 60_000);
    const result = await sweepSupplementImages(this.state.storage, this.env);
    if (!result.more) await this.state.storage.deleteAlarm();
    return result;
  }

  async handle(request) {
    const url = new URL(request.url);

    if (registrationNotePaths.has(url.pathname)) return registrationNumberNotes(request, this.env, this.state.storage);

    // Reachable only through the existing DO binding, never through public routing.
    if (request.method === 'POST' && url.pathname === '/_internal/supplement-retention') {
      return json({success: true, ...await this.runRetention()});
    }

    if (supplementPaths.has(url.pathname)) return supplementService(request, this.env, this.state.storage);

    if (request.method !== "POST" || url.pathname !== "/admin/review") {
      return new Response(JSON.stringify({ success: false, message: "Not Found" }), {
        status: 404,
        headers: { "Content-Type": "application/json; charset=UTF-8", "Cache-Control": "no-store" }
      });
    }

    if (!this.env.ADMIN_KEY || request.headers.get('X-Admin-Key') !== this.env.ADMIN_KEY) return json({success:false,message:'Unauthorized.'},401);
    let body;try{body=await request.clone().json();}catch{return json({success:false,message:'入力内容を確認してください。'},400);}
    if(body.result==='additional_check')return json({success:false,message:'追加依頼欄に必要な内容を記入し、依頼を掲載してください。'},400);
    const recordKey='supplement:'+body.ap+':'+body.item;
    const record=await this.state.storage?.get(recordKey);
    if(record?.rounds.at(-1)?.status==='closed')return json({success:false,message:'未提出による手続終了済みです。'},409);
    if(record&&(APPROVED_RESULTS.has(body.result)||body.result==='rejected'))await ensureRetentionAlarm(this.state.storage);
    const response=await app.fetch(request, this.env, { waitUntil() {} });
    if(response.ok&&this.state.storage&&(APPROVED_RESULTS.has(body.result)||body.result==='rejected')) {
      await this.state.storage.put('supplement-final:'+body.ap+':'+body.item,{result:body.result,at:new Date().toISOString()});
      if(record){for(const round of record.rounds)if(round.status!=='closed')round.status='resolved';record.revision++;await this.state.storage.put(recordKey,record);}
      if(record)await tryPurgeSupplementImages(this.state.storage,body.ap,body.item,record);
    }
    return response;
  }
}
