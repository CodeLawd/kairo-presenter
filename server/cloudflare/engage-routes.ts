import { AUDIENCE_CODE, normalizeAudienceRoomSettings } from '../../src/lib/audience-protocol'
import { normalizeEngagementInput } from '../../src/lib/engage'
import { audienceTokenHash } from './audience-room'
import { roomCode, type AudienceEnv } from './audience-routes'

export async function engageRoutes(request: Request, env: AudienceEnv, verify: (request:Request)=>Promise<Response>, headers: Headers): Promise<Response> {
  const url=new URL(request.url)
  const authHeaders=new Headers({Authorization:request.headers.get('Authorization')??''})
  const identity=async (needOrgName = false, allowWebAdmin = false):Promise<{orgId:string;orgName:string}|Response>=>{
    if(!request.headers.get('Authorization')?.startsWith('Bearer '))return Response.json({message:'Sign in to Kairo.'},{status:401,headers})
    const licence=await verify(new Request(new URL('/v1/licensing',url),{headers:authHeaders}))
    if(!licence.ok)return new Response(licence.body,{status:licence.status,headers})
    const snapshot=await licence.json() as {activated?:boolean;lease?:{claims:{orgId:string}};license?:{orgId:string;status:string;expiresAt:string|null}|null}
    let orgId:string
    if(snapshot.activated&&snapshot.lease) orgId=snapshot.lease.claims.orgId
    else if(allowWebAdmin) {
      // Dashboard: no activated device, so require an owner/admin of a church with an active licence.
      const lic=snapshot.license
      if(!lic||lic.status!=='active'||(lic.expiresAt&&Date.parse(lic.expiresAt)<=Date.now()))return Response.json({message:'Your church needs an active Kairo licence to use Engage.'},{status:403,headers})
      const session=await verify(new Request(new URL('/v1/auth/session',url),{headers:authHeaders}))
      if(!session.ok)return new Response(session.body,{status:session.status,headers})
      const who=await session.json() as {orgId?:string|null;role?:string|null}
      if(who.orgId!==lic.orgId||(who.role!=='owner'&&who.role!=='admin'))return Response.json({message:'Only church owners and admins can create engagements.'},{status:403,headers})
      orgId=lic.orgId
    } else return Response.json({message:'Activate Kairo to use Engage.'},{status:403,headers})
    if(!needOrgName)return {orgId,orgName:'Kairo'}
    const response=await verify(new Request(new URL(`/v1/orgs/${encodeURIComponent(orgId)}`,url),{headers:authHeaders}))
    if(!response.ok)return new Response('Could not check organisation',{status:403,headers})
    const org=await response.json() as {name?:string}
    return {orgId,orgName:String(org.name||'Kairo').slice(0,100)}
  }
  const json=async ():Promise<unknown>=>{const text=await request.text();if(text.length>8192)throw Error('Request too large');return JSON.parse(text)}
  try {
    if(url.pathname==='/v1/engage') {
      if(request.method==='GET') {
        const owner=await identity(false,true);if(owner instanceof Response)return owner
        const response=await verify(new Request(new URL(`/v1/orgs/${encodeURIComponent(owner.orgId)}/engagements`,url),{headers:authHeaders}))
        return new Response(response.body,{status:response.status,headers})
      }
      if(request.method!=='POST')return new Response('Method not allowed',{status:405,headers})
      const owner=await identity(true,true);if(owner instanceof Response)return owner
      const body=await json(),input=normalizeEngagementInput(body),settings=normalizeAudienceRoomSettings((body as {settings?:unknown}).settings)
      for(let attempt=0;attempt<8;attempt++) {
        const code=roomCode(),token=crypto.randomUUID()+crypto.randomUUID(),room=env.AUDIENCE_ROOM.getByName(code)
        if(!await room.initialize({code,title:input.name,orgName:owner.orgName,orgId:owner.orgId,startsAt:input.startsAt,endsAt:input.endsAt,status:input.status,tokenHash:await audienceTokenHash(token),settings}))continue
        // Register via authenticated internal endpoint once. The DO owns subsequent lifecycle writes.
        const internalHeaders=new Headers({'Content-Type':'application/json',Authorization:`Bearer ${env.ENGAGE_INTERNAL_SECRET??''}`})
        const indexed=await verify(new Request(new URL('/v1/internal/engage/index',url),{method:'POST',headers:internalHeaders,body:JSON.stringify({orgId:owner.orgId,id:code,code,name:input.name,status:input.status,startsAt:input.startsAt,endsAt:input.endsAt})}))
        if(!indexed.ok){await room.abortCreation();return Response.json({message:'Could not save the engagement. Check the server configuration and try again.'},{status:503,headers})}
        const engagement=await room.describe()
        const publicUrl=typeof env.PUBLIC_WEB_URL==='string'?env.PUBLIC_WEB_URL:'https://kairopresenter.com'
        return Response.json({roomId:code,code,title:input.name,operatorToken:token,settings,engagement,url:`${publicUrl.replace(/\/$/,'')}/q/${code}`},{status:201,headers})
      }
      return new Response('Could not reserve a code',{status:503,headers})
    }
    const match=/^\/v1\/engage\/([^/]+)\/(.+)$/.exec(url.pathname)
    if(!match||!AUDIENCE_CODE.test(match[1]))return new Response('Not found',{status:404,headers})
    const [,code,action]=match,room=env.AUDIENCE_ROOM.getByName(code)
    if(request.method!=='POST')return new Response('Method not allowed',{status:405,headers})
    if(action==='resume') {
      const owner=await identity(false, true);if(owner instanceof Response)return owner
      const token=crypto.randomUUID()+crypto.randomUUID()
      if(!await room.resume(owner.orgId,await audienceTokenHash(token)))return new Response('Not found',{status:404,headers})
      const engagement=await room.describe()
      const publicUrl=typeof env.PUBLIC_WEB_URL==='string'?env.PUBLIC_WEB_URL:'https://kairopresenter.com'
      return Response.json({roomId:code,code,title:engagement!.name,operatorToken:token,settings:engagement!.activities.qa,engagement,url:`${publicUrl.replace(/\/$/,'')}/q/${code}`},{headers})
    }
    if(action==='live') {
      const owner=await identity(false, true);if(owner instanceof Response)return owner
      const body=await json() as {live?: boolean}
      const token=crypto.randomUUID()+crypto.randomUUID()
      if(!await room.resume(owner.orgId,await audienceTokenHash(token)))return new Response('Not found',{status:404,headers})
      const manageReq=new Request(request.url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:'{}'})
      const res=await room.manage(manageReq, body?.live === false ? 'close' : 'open')
      const merged=new Headers(headers);for(const [key,value] of res.headers)merged.set(key,value)
      return new Response(res.body,{status:res.status,headers:merged})
    }
    let response:Response
    if(action==='exchange'||action==='request-link'||action==='moderator-session')response=await room.moderatorAccess(new Request(request.url,{method:'POST',headers:request.headers,body:JSON.stringify(await json())}),action==='moderator-session'?'session':action)
    else if(['open','close','delete','credentials','moderators'].includes(action)||/^revoke\/[a-f0-9-]{36}$/.test(action))response=await room.manage(new Request(request.url,{method:'POST',headers:request.headers,body:JSON.stringify(await json())}),action)
    else return new Response('Not found',{status:404,headers})
    const merged=new Headers(headers);for(const [key,value] of response.headers)merged.set(key,value)
    return new Response(response.body,{status:response.status,headers:merged})
  } catch(error) {
    return Response.json({message:error instanceof Error?error.message:'Could not complete the action.'},{status:400,headers})
  }
}
