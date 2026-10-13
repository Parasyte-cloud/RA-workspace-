export type ImportedDraft = { title:string; excerpt:string; body:string; category?:string }
const SIMPLE_EXTENSIONS = new Set(['md','txt','json'])
const ALLOWED_CATEGORIES = new Set(['Mobility','Travel guides','Company news','For drivers'])
const extensionOf = (name:string) => name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || ''
const firstMarkdownTitle = (body:string) => body.match(/^#\s+(.+)$/m)?.[1]?.trim().slice(0,160) || ''
export function parseSimpleBlogImport(filename:string, text:string):ImportedDraft {
  const ext=extensionOf(filename)
  if(!SIMPLE_EXTENSIONS.has(ext)) throw new Error('Choose a supported import file: DOCX, PDF, Markdown, TXT or Blog article JSON.')
  if(ext==='txt') return {title:'',excerpt:'',body:text.replace(/\r\n?/g,'\n')}
  if(ext==='md') return {title:firstMarkdownTitle(text),excerpt:'',body:text.replace(/\r\n?/g,'\n')}
  let value:unknown
  try{value=JSON.parse(text)}catch{throw new Error('This is not valid Blog article JSON.')}
  if(!value||typeof value!=='object'||Array.isArray(value)) throw new Error('This is not a supported Blog article JSON object.')
  const obj=value as Record<string,unknown>
  if(typeof obj.title!=='string'||typeof obj.body!=='string') throw new Error('Blog article JSON must include text title and body fields.')
  const draft:ImportedDraft={title:obj.title.trim().slice(0,160),excerpt:typeof obj.excerpt==='string'?obj.excerpt.trim().slice(0,320):'',body:obj.body}
  if(typeof obj.category==='string'&&ALLOWED_CATEGORIES.has(obj.category))draft.category=obj.category
  return draft
}
async function parseDocx(file:File):Promise<ImportedDraft>{
  const mammoth=await import('mammoth')
  // @ts-expect-error turndown may not publish bundled TypeScript declarations in every supported release.
  const turndownModule=await import('turndown')
  const TurndownService=turndownModule.default
  const result=await mammoth.convertToHtml({arrayBuffer:await file.arrayBuffer()})
  const body=new TurndownService({headingStyle:'atx',bulletListMarker:'-'}).turndown(result.value).trim()
  if(!body)throw new Error('No readable text was found in this DOCX. Keep the source file and create a blank draft instead.')
  return {title:firstMarkdownTitle(body),excerpt:'',body}
}
async function parsePdf(file:File):Promise<ImportedDraft>{
  try{
    const pdf=await import('pdfjs-dist/legacy/build/pdf.mjs')
    const worker=await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')
    pdf.GlobalWorkerOptions.workerSrc=worker.default
    const loading=pdf.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false})
    const doc=await loading.promise
    const pages:string[]=[]
    for(let n=1;n<=doc.numPages;n++){
      const page=await doc.getPage(n),content=await page.getTextContent()
      const text=content.items.map((item:unknown)=>typeof item==='object'&&item&&'str' in item?String((item as {str:unknown}).str):'').join(' ').replace(/\s+/g,' ').trim()
      if(text)pages.push(text)
    }
    const body=pages.join('\n\n---\n\n').trim()
    if(!body)throw new Error('No readable text was found.')
    return {title:'',excerpt:'',body}
  }catch(error){
    const detail=error instanceof Error?error.message:''
    throw new Error(`We could not extract this PDF reliably. The uploaded source remains available for retry or a blank draft.${detail?' '+detail:''}`)
  }
}
export async function parseBlogImport(file: File):Promise<ImportedDraft>{
  const ext=extensionOf(file.name)
  if(['md','txt','json'].includes(ext))return parseSimpleBlogImport(file.name,await file.text())
  if(ext==='docx')return parseDocx(file)
  if(ext==='pdf')return parsePdf(file)
  throw new Error('Choose a supported import file: DOCX, PDF, Markdown, TXT or Blog article JSON.')
}
