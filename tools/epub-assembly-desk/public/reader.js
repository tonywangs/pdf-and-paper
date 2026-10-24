let book,rendition;const $=id=>document.getElementById(id);let ready;
async function open(bytes){if(book)book.destroy();$('reader').replaceChildren();book=ePub(bytes);rendition=book.renderTo('reader',{width:'100%',height:720,flow:'scrolled-doc',spread:'none',allowScriptedContent:false});await book.ready;const nav=await book.loaded.navigation;$('toc').replaceChildren();for(const item of nav.toc){const o=document.createElement('option');o.value=item.href;o.textContent=item.label;$('toc').append(o);}rendition.on('relocated',loc=>{const href=loc.start.href;const match=[...$('toc').options].find(o=>o.value.split('#')[0]===href);if(match)$('toc').value=match.value;$('reader-status').textContent='Reading: '+href;});await rendition.display();window.readerBook=book;window.readerRendition=rendition;}
function run(fn){ready=fn().catch(e=>{$('reader-status').textContent=e.message;throw e;});window.readerReady=ready;}
$('sample').onclick=()=>run(async()=>open(await(await fetch('/sample.epub')).arrayBuffer()));
$('book-file').onchange=e=>run(async()=>open(await e.target.files[0].arrayBuffer()));
$('toc').onchange=()=>run(async()=>rendition.display($('toc').value));
$('previous').onclick=()=>run(async()=>rendition.prev());$('next').onclick=()=>run(async()=>rendition.next());
