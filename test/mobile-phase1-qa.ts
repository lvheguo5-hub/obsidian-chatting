import { Plugin, Notice, Platform, apiVersion } from 'obsidian';
const EXPECTED = 'c00e4fcb9b69505504223a43c89bff45185acec24a05a63ce832755bc10c097e';
export default class MobilePhase1QA extends Plugin {
  async onload() {
    if (this.app.vault.getName() !== 'Chatting Phase1 QA') return;
    this.addCommand({id:'capture',name:'Phase1: capture device layout',callback:()=>{void this.capture()}});
    this.addCommand({id:'open',name:'Phase1: open candidate chat',callback:()=>{void (this.app as any).plugins.plugins['chatting-with-ai']?.activateView()}});
    this.app.workspace.onLayoutReady(()=>{void this.prepare()});
  }
  async prepare() {
    const p=(this.app as any).plugins.plugins['chatting-with-ai'];
    if(!p){new Notice('QA: candidate plugin is not enabled');return;}
    const source=await this.app.vault.adapter.read('.obsidian/plugins/chatting-with-ai/main.js');
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source))),b=>b.toString(16).padStart(2,'0')).join('');
    if(digest!==EXPECTED){new Notice('QA: candidate hash mismatch',20000);return;}
    const original=p.agent.run.bind(p.agent);
    p.agent.run=async(text:any,cb:any)=>{
      const version=p.agent.runVersion;
      const current=()=>version===p.agent.runVersion;
      cb.onThinking();
      await new Promise(r=>setTimeout(r,500));if(!current())return;
      const input={path:'QA/Tool.md',operation:'insert',position:'end',content:'\nPHASE1-DEVICE-TOOL'};
      cb.onToolCall('edit_document',input);
      await new Promise(r=>setTimeout(r,700));if(!current())return;
      const f=this.app.vault.getFileByPath(input.path);
      if(f)await this.app.vault.process(f,s=>s+input.content);
      cb.onToolResult('edit_document',{result:'Device test note updated: PHASE1-DEVICE-TOOL',isError:false});
      const reply='PHASE1-DEVICE-OK\n\nInline \\(x^2\\), display:\n\\[y=x+1\\]\n\nSynthetic provider; actual Obsidian UI and test-vault write.';
      p.agent.importMessages([...p.agent.exportMessages(),{role:'user',content:text},{role:'assistant',content:reply}]);
      cb.onResponse(reply);
    };
    this.register(()=>{p.agent.run=original});
    (window as any).__phase1CandidateHash=digest;
    new Notice('Phase1 QA ready: exact candidate; synthetic provider; isolated vault',9000);
    await p.activateView();
  }
  async capture() {
    const el=document.querySelector('.ochatting-input') as HTMLElement;
    const v=document.querySelector('.ochatting-view-container') as HTMLElement;
    const rect=el?.getBoundingClientRect();
    const report={time:new Date().toISOString(),appVersion:apiVersion,isPhone:Platform.isPhone,isMobile:Platform.isMobile,scope:'physical iPhone; production candidate UI; synthetic provider companion',candidateSha256:(window as any).__phase1CandidateHash,viewport:{width:innerWidth,height:innerHeight,visualHeight:visualViewport?.height},keyboardHeight:getComputedStyle(document.body).getPropertyValue('--keyboard-height'),lift:v?.style.getPropertyValue('--ochatting-lift'),input:rect?{x:rect.x,y:rect.y,width:rect.width,height:rect.height,bottom:rect.bottom}:null,mathNodes:document.querySelectorAll('.math').length,toolSteps:document.querySelectorAll('.ochatting-tool').length,failures:document.querySelectorAll('.ochatting-tool.is-error').length};
    const path='QA/device-report.json';await this.app.vault.adapter.write(path,JSON.stringify(report,null,2));new Notice('Device layout report saved',6000);
  }
}
