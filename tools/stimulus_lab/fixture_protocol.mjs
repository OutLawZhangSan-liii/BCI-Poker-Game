// Fixture generation uses the actual seeded protocol and production geometry.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
const cache=new Map();
function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>load(path.resolve(path.dirname(file),name+'.ts'))});return exports;}
const {createLabRun,labTemplate}=load(path.resolve('renderer/src/lab/protocol.ts'));
if(process.argv[2]==='--validate'){
 const run=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
 const {validateLabRecord}=load(path.resolve('desktop/main/labRecord.ts'));
 validateLabRecord(run,run);
 if(JSON.stringify(createLabRun(run.id,run.seed,run.createdAt).items)!==JSON.stringify(run.items))throw new Error('Seed and actual protocol order do not match');
 process.stdout.write('valid');process.exit(0);
}
const {computeResponsiveStimulusGeometry}=load(path.resolve('renderer/src/bci/stimulus/geometry.ts'));
const run=createLabRun('00000000-0000-0000-0000-000000000042',704,'2026-10-10T00:00:00Z');
const templates={},geometry={};
for(const count of [2,4,6]){
 const template=labTemplate(count);templates[count]=template;
 geometry[count]=computeResponsiveStimulusGeometry({width:1876,height:720,targets:template.targets,referenceX:template.referenceX,referenceY:template.referenceY,compactCards:count>2,showReference:false});
}
process.stdout.write(JSON.stringify({run,templates,geometry}));
