import test from 'node:test';import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';import { stripTypeScriptTypes } from 'node:module';
const source=readFileSync('src/lib/blogPolicy.ts','utf8');
const P=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
const read=p=>existsSync(p)?readFileSync(p,'utf8'):'';
test('Blog origin defaults to the canonical site',()=>assert.equal(P.resolveBlogOrigin(),'https://blog.ridearrivo.com'));
test('workspace tokens may only be sent to explicitly trusted Blog origins',()=>{assert.equal(P.resolveBlogOrigin('https://blog-3h5.pages.dev/'),'https://blog-3h5.pages.dev');for(const v of ['https://evil.test','https://blog.ridearrivo.com.evil.test','https://blog.ridearrivo.com/path','https://user@blog.ridearrivo.com','http://blog.ridearrivo.com'])assert.throws(()=>P.resolveBlogOrigin(v));});
test('localhost API allowed only in development',()=>{assert.throws(()=>P.resolveBlogOrigin('http://127.0.0.1:8788'));assert.equal(P.resolveBlogOrigin('http://127.0.0.1:8788',true),'http://127.0.0.1:8788');});
test('native writer controls match server ownership restrictions',()=>{assert.equal(P.canEditBlogPost('writer','a',{author_id:'a',status:'draft',ever_published:false}),true);assert.equal(P.canEditBlogPost('writer','a',{author_id:'b',status:'draft',ever_published:false}),false);assert.equal(P.canEditBlogPost('writer','a',{author_id:'a',status:'draft',ever_published:true}),false);});
test('native editor can review another authors draft',()=>assert.equal(P.canEditBlogPost('editor','a',{author_id:'b',status:'draft',ever_published:false}),true));
test('Lagos scheduling is independent of browser timezone',()=>{assert.equal(P.fromLagosInput('2026-10-14T09:30'),'2026-10-14T08:30:00.000Z');assert.equal(P.toLagosInput('2026-10-14T08:30:00Z'),'2026-10-14T09:30');});
test('invalid calendar dates cannot silently normalize',()=>{assert.throws(()=>P.fromLagosInput('2026-02-31T09:30'));assert.throws(()=>P.fromLagosInput(''));});
test('Blog Studio is lazy-loaded and present in navigation',()=>{const app=read('src/App.tsx');assert.match(app,/\['blog','Blog Studio',/);assert.match(app,/blog:\['admin'\]/);assert.match(app,/workspace_blog_identity/);assert.match(read('src/lazy-routes.tsx'),/import\('\.\/modules\/BlogStudio'\)/);});
test('RPC grants are server-checked and direct writes are revoked',()=>{const sql=read('supabase/migrations/20261013130000_blog_studio_access.sql');assert.match(sql,/workspace_blog_set_access/);assert.match(sql,/auth\.uid\(\)/);assert.match(sql,/pg_advisory_xact_lock/);assert.match(sql,/revoke all on public\.workspace_blog_access from public, anon, authenticated, service_role/i);assert.match(sql,/set search_path = ''/);assert.match(sql,/p\.active = true/);});
test('access migration does not move blog content into Supabase',()=>{const sql=read('supabase/migrations/20261013130000_blog_studio_access.sql');assert.doesNotMatch(sql,/create table[^;]*(?:ra_blog_posts|blog_articles|blog_media)/i);assert.match(sql,/workspace_blog_access_audit/);});
test('client sends bearer credentials in headers, never URL or localStorage',()=>{const s=read('src/lib/blogStudio.ts');assert.match(s,/Authorization: `Bearer \$\{session\.access_token\}`/);assert.doesNotMatch(s,/localStorage|access_token=.*\+|searchParams\.set\(['"]token/);assert.match(s,/credentials: 'omit'/);});
test('native navigation fixture includes the additional Blog Studio section',()=>{const t=read('scripts/workspace-nav.test.mjs');assert.match(t,/assert\.equal\(REAL\.length, 36\)/);});
test('Blog import library supports simple text and JSON drafts without lifecycle trust',async()=>{
  const s=read('src/lib/blogImport.ts');assert.ok(s,'blogImport.ts must exist');
  const mod=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(s)).toString('base64'));
  assert.deepEqual(mod.parseSimpleBlogImport('note.txt','Hello\n\nWorld'),{title:'',excerpt:'',body:'Hello\n\nWorld'});
  assert.deepEqual(mod.parseSimpleBlogImport('note.md','# Hello\n\n**World**'),{title:'Hello',excerpt:'',body:'# Hello\n\n**World**'});
  const parsed=mod.parseSimpleBlogImport('article.json',JSON.stringify({title:'Imported',excerpt:'Review this',body:'Body',category:'Mobility',status:'published',fact_checked:true,published_at:'tomorrow'}));
  assert.deepEqual(parsed,{title:'Imported',excerpt:'Review this',body:'Body',category:'Mobility'});
  assert.throws(()=>mod.parseSimpleBlogImport('bad.json','{"arbitrary":true}'),/Blog article JSON/i);
  assert.throws(()=>mod.parseSimpleBlogImport('bad.html','<h1>x</h1>'),/supported import/i);
});
test('Blog import source uses mammoth turndown and pdfjs only for DOCX/PDF paths',()=>{
  const s=read('src/lib/blogImport.ts');assert.match(s,/import\(['"]mammoth['"]\)/);assert.match(s,/import\(['"]turndown['"]\)/);assert.match(s,/pdfjs-dist/);assert.match(s,/parseBlogImport\(file: File\)/);
  const pkg=JSON.parse(read('package.json'));for(const name of ['mammoth','turndown','pdfjs-dist'])assert.ok(pkg.dependencies?.[name],`${name} dependency missing`);
});
test('Blog API client exposes generic asset and import contracts without leaking tokens',()=>{
  const s=read('src/lib/blogStudio.ts');for(const name of ['uploadBlogAsset','importBlogDraft','linkBlogAsset','unlinkBlogAsset'])assert.match(s,new RegExp(`export async function ${name}`));
  assert.match(s,/X-Asset-Kind/);assert.doesNotMatch(s,/access_token=.*URL|searchParams\.set\(['"]token/);
  assert.match(s,/BlogContentType/);assert.match(s,/BlogAssetRelationship/);
});
test('Articles exposes the editorial workflow directly instead of routing creation through Files & media',()=>{
  const s=read('src/modules/BlogStudio.tsx');
  assert.match(s,/className="bs-article-actions"/);
  for(const label of ['New article','Import document','Quick writeup'])assert.match(s,new RegExp(label));
  assert.match(s,/onClick=\{newDraft\}/);
  assert.match(s,/void extractImport\(file\)/);
  assert.doesNotMatch(s,/What are you publishing\?/);
  assert.doesNotMatch(s,/ADD_CONTENT_ACTIONS/);
});

test('Article editor presents the five-step editorial workflow and publication checks',()=>{
  const s=read('src/modules/BlogStudio.tsx');
  assert.match(s,/bs-editorial-workflow/);
  for(const label of ['Create draft','Details & content','Sources & attachments','Publication checks','Publish or schedule'])assert.match(s,new RegExp(label));
  assert.match(s,/>Summary</);
  assert.match(s,/facts, sources and image rights/i);
  assert.match(s,/Publish now/);
  assert.match(s,/Schedule publication/);
});
test('quick composer is body-first and publication remains permission-gated',()=>{
  const s=read('src/modules/BlogStudio.tsx');
  assert.match(s,/content_type==='quick_post'/);assert.match(s,/Quick writeup body/);assert.match(s,/character count/i);assert.match(s,/me\.permissions\.publish/);
  assert.match(s,/Optional image/);assert.match(s,/category/i);
});
test('import flow preserves uploaded source across extraction failure and creates drafts only',()=>{
  const s=read('src/modules/BlogStudio.tsx');
  for(const phrase of ['Extraction preview','Create draft','Retry extraction','Create blank draft'])assert.match(s,new RegExp(phrase));
  assert.match(s,/sourceAsset/);assert.match(s,/parseBlogImport/);assert.match(s,/importBlogDraft/);
});
test('generic assets can be listed linked and unlinked from saved drafts',()=>{
  const s=read('src/modules/BlogStudio.tsx');assert.match(s,/listBlogAssets/);assert.match(s,/linkBlogAsset/);assert.match(s,/unlinkBlogAsset/);assert.match(s,/Files & media/);
  const client=read('src/lib/blogStudio.ts');assert.match(client,/listPostAssets/);
});
test('mobile editorial entry actions remain touch-safe without a creation bottom sheet',()=>{
  const s=read('src/modules/BlogStudio.tsx'),css=read('src/blog-studio.css');
  assert.match(s,/bs-article-actions/);
  assert.match(css,/bs-article-actions/);
  assert.match(css,/min-height:\s*44px/);
  assert.match(css,/@media\s*\(max-width:\s*640px\)/);
  assert.doesNotMatch(s,/bs-add-sheet/);
});
test('asset uploads infer approved MIME types when browser File.type is empty',()=>{
  const client=read('src/lib/blogStudio.ts');
  for(const pair of [
    [".pdf",'application/pdf'],
    [".docx",'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    [".md",'text/markdown'],
    [".txt",'text/plain'],
    [".json",'application/json'],
  ]){
    assert.match(client,new RegExp(pair[0].replace('.','\\.')+'.*'+pair[1]));
  }
  assert.match(client,/inferBlogAssetMime/);
});
test('cancelling the import picker is a no-op instead of passing undefined as File',()=>{
  const s=read('src/modules/BlogStudio.tsx');
  assert.doesNotMatch(s,/files\?\.\[0\]\s+as File/);
  assert.match(s,/const file=e\.target\.files\?\.\[0\];if\(file\)/);
});
test('generic uploads classify images from inferred MIME and article uploads attach immediately',()=>{
  const s=read('src/modules/BlogStudio.tsx');
  assert.match(s,/inferBlogAssetMime/);
  assert.match(s,/const image=inferBlogAssetMime\(file\)\.startsWith\('image\/'\)/);
  assert.match(s,/uploadGeneric\(file,true\)/);
  assert.match(s,/linkBlogAsset\(draft\.id,asset\.id,'attachment'\)/);
  assert.match(s,/const relationship:BlogAssetRelationship='attachment'/);
});

test(
  'Blog publishers get explicit lifecycle actions and archive stays separate',
  () => {
    const s = read(
      'src/modules/BlogStudio.tsx',
    )

    for (const label of [
      'Save draft',
      'Submit for review',
      'Publish now',
      'Schedule publication',
      'Archive content',
    ]) {
      assert.match(
        s,
        new RegExp(label),
        `${label} action must be explicit`,
      )
    }

    assert.doesNotMatch(
      s,
      /<label>Status<select/,
      'publishing must not depend on a lifecycle dropdown',
    )

    assert.doesNotMatch(
      s,
      /<option value="published">Published<\/option>/,
      'Published must not be a dropdown option',
    )

    assert.doesNotMatch(
      s,
      /<option value="archived">Archived<\/option>/,
      'Archived must not be a dropdown option',
    )

    assert.doesNotMatch(
      s,
      /window\.confirm\(['"]Archive this content\?/,
      'archiving must not depend on a native browser dialog',
    )
    assert.match(
      s,
      /Confirm archive/,
      'archiving must require an in-app confirmation action',
    )
  },
)

// BLOG_FILES_MEDIA_ACTIONS_TEST_START

test(
  'Files & media standalone assets expose publish and delete API contracts',
  () => {
    const client = read('src/lib/blogStudio.ts')

    assert.match(
      client,
      /published_at:string\|null/,
      'BlogAsset must expose publication state',
    )

    assert.match(
      client,
      /published_by:string\|null/,
      'BlogAsset must expose publisher state',
    )

    assert.match(
      client,
      /export async function setBlogAssetPublished/,
      'asset publish client is missing',
    )

    assert.match(
      client,
      /export async function deleteBlogAsset/,
      'asset delete client is missing',
    )

    assert.match(
      client,
      /assets\/\$\{assetId\}/,
      'asset lifecycle operations must target the asset resource',
    )

    assert.match(
      client,
      /method:'PATCH'/,
      'publishing must use PATCH',
    )

    assert.match(
      client,
      /method:'DELETE'/,
      'deletion must use DELETE',
    )
  },
)

test(
  'Files & media standalone assets render role-aware lifecycle controls',
  () => {
    const ui = read('src/modules/BlogStudio.tsx')

    for (const label of [
      'Publish',
      'Unpublish',
      'Open public link',
      'Copy link',
      'Delete',
    ]) {
      assert.match(
        ui,
        new RegExp(label),
        `${label} control is missing from Files & media`,
      )
    }

    assert.match(
      ui,
      /setBlogAssetPublished/,
      'publish handler must call the Blog asset API',
    )

    assert.match(
      ui,
      /deleteBlogAsset/,
      'delete handler must call the Blog asset API',
    )

    assert.match(
      ui,
      /me\.permissions\.publish&&asset\.asset_kind!=='source'/,
      'source imports must never expose Publish',
    )

    assert.match(
      ui,
      /me\.permissions\.remove/,
      'Delete must remain Blog Administrator gated',
    )

    assert.match(
      ui,
      /\/files\/\$\{asset\.id\}/,
      'published assets must expose their public file URL',
    )
  },
)

// BLOG_FILES_MEDIA_ACTIONS_TEST_END


test('Blog lifecycle mutations use a synchronous in-flight guard to prevent self-conflicts',()=>{
  const s=read('src/modules/BlogStudio.tsx')
  assert.match(s,/saveInFlightRef=useRef\(false\)/)
  assert.match(s,/if\(!draft\|\|busy\|\|saveInFlightRef\.current\)return/)
  assert.match(s,/saveInFlightRef\.current=true/)
  assert.match(s,/saveInFlightRef\.current=false/)
})

test('archiving uses an in-app confirmation and reports the archived state',()=>{
  const s=read('src/modules/BlogStudio.tsx')
  assert.doesNotMatch(s,/window\.confirm\(['"]Archive this content\?/)
  assert.match(s,/archiveConfirming/)
  assert.match(s,/Confirm archive/)
  assert.match(s,/void save\(undefined,'archived'\)/)
  assert.match(s,/Content archived\. It is no longer public\./)
})
