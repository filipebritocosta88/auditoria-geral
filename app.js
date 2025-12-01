// app.js - Auditoria Geral System
const PDVS = ["Salvador Shopping","Shopping da Bahia","Shopping Paralela","Bela Vista","Lauro de Freitas","Barra","Rio de Janeiro","Belo Horizonte","Manaus","Recife Riomar","Recife Ultra","Maceio Parque","Shopping Maceio","Vila Velha","Vitoria","Fortaleza","Belém"];
let useFirebase = false;
let db = null;
let auth = null;
let currentUser = null;
let adminEmails = [];

function init() {
  const pdvSelect = document.getElementById('pdv-select');
  PDVS.forEach(p=>{ const o=document.createElement('option'); o.value=p; o.textContent=p; pdvSelect.appendChild(o); });
  pdvSelect.addEventListener('change', () => { renderTable(); buildFilters(); });
  document.getElementById('search').addEventListener('input', renderTable);
  document.getElementById('search-id').addEventListener('change', renderTable);
  document.getElementById('search-cat').addEventListener('change', renderTable);
  document.getElementById('search-all').addEventListener('change', renderTable);

  document.getElementById('add-row-btn').addEventListener('click', ()=>openModal());
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-form').addEventListener('submit', onSaveRow);
  document.getElementById('file-input').addEventListener('change', onFileInput);
  document.getElementById('export-xlsx').addEventListener('click', exportXLSX);
  document.getElementById('export-csv').addEventListener('click', exportCSV);
  document.getElementById('clear-local').addEventListener('click', clearLocalPDV);
  document.getElementById('apply-filters').addEventListener('click', renderTable);
  document.getElementById('clear-filters').addEventListener('click', clearFilters);
  document.getElementById('login-btn').addEventListener('click', onLoginClick);
  document.getElementById('logout-btn').addEventListener('click', onLogout);

  // try to init firebase if provided
  try {
    if(window.firebase && window.firebaseConfig && window.firebaseConfig.apiKey) {
      firebase.initializeApp(window.firebaseConfig);
      auth = firebase.auth();
      db = firebase.firestore();
      useFirebase = true;
      auth.onAuthStateChanged(u=>{ currentUser=u; updateAuthUI(); loadAdminEmails().then(()=>renderTable()); });
    }
  } catch(e){ console.log('Firebase not configured', e); }

  fetch('admin_emails.json').then(r=>r.json()).then(j=>adminEmails=j).catch(()=>{});

  buildFilters();
  renderTable();
  initCharts();
}

function getStorageKey(pdv){ return 'auditoria__' + pdv.replace(/\s+/g,'_'); }
function loadLocal(pdv){ const raw = localStorage.getItem(getStorageKey(pdv)); if(!raw) return []; try{ return JSON.parse(raw); }catch(e){return []} }
function saveLocal(pdv, rows){ localStorage.setItem(getStorageKey(pdv), JSON.stringify(rows)); }

async function loadFromFirestore(pdv){ try{ const snap = await db.collection('auditorias').where('pdv','==',pdv).get(); return snap.docs.map(d=>({ _docId:d.id, ...d.data() })); }catch(e){console.error(e); return []; } }
async function saveToFirestore(pdv, row){ try{ if(row._docId) { await db.collection('auditorias').doc(row._docId).set(row); return; } const doc = await db.collection('auditorias').add({...row, pdv}); row._docId = doc.id; }catch(e){console.error(e)} }
async function deleteFromFirestore(docId){ try{ await db.collection('auditorias').doc(docId).delete(); }catch(e){console.error(e)} }

async function loadAdminEmails(){ if(useFirebase){ try{ const snap = await db.collection('configs').doc('admin').get(); if(snap.exists) adminEmails = snap.data().emails || []; }catch(e){console.log(e)} } }

function isAdmin(user){ if(!user) return false; const email = user.email || ''; return adminEmails.includes(email); }

async function renderTable(){ const pdv = document.getElementById('pdv-select').value || PDVS[0]; const tbody = document.querySelector('#auditoria-table tbody'); tbody.innerHTML = ''; let rows = useFirebase ? await loadFromFirestore(pdv) : loadLocal(pdv);

  // apply search
  const q = document.getElementById('search').value.trim().toUpperCase();
  const searchId = document.getElementById('search-id').checked;
  const searchCat = document.getElementById('search-cat').checked;
  const searchAll = document.getElementById('search-all').checked;

  if(q) {
    rows = rows.filter(r => {
      const idField = (r.id||'').toUpperCase();
      const catField = (r.categoria||'').toUpperCase();
      const combined = Object.values(r).join(' ').toUpperCase();
      let ok = false;
      if(searchAll) ok = combined.indexOf(q) > -1;
      if(searchId && !ok) ok = idField.indexOf(q) > -1;
      if(searchCat && !ok) ok = catField.indexOf(q) > -1;
      return ok;
    });
  }

  // apply filters
  const activeFilters = getActiveFilters();
  if(Object.keys(activeFilters).length>0) {
    rows = rows.filter(r => {
      return Object.entries(activeFilters).every(([k,v]) => {
        if(!v) return true;
        return (r[k]||'').toString().toUpperCase().indexOf(v.toUpperCase()) > -1;
      });
    });
  }

  rows.forEach((r, idx) => {
    const tr = document.createElement('tr');
    const cols = ['id','nome','categoria','subcategoria','sistema','fisico','situacao','data','motivo','resolvido'];
    cols.forEach(c => {
      const td = document.createElement('td'); td.textContent = r[c] || ''; tr.appendChild(td);
    });
    const tdActions = document.createElement('td');
    const btnEdit = document.createElement('button'); btnEdit.textContent='Editar'; btnEdit.onclick=()=>openModal(r, idx);
    const btnDel = document.createElement('button'); btnDel.textContent='Excluir'; btnDel.onclick=()=>onDelete(r, idx);
    tdActions.appendChild(btnEdit); tdActions.appendChild(btnDel);
    tr.appendChild(tdActions);
    tbody.appendChild(tr);
  });

  updateCharts(rows);
  document.getElementById('admin-section').style.display = (currentUser && isAdmin(currentUser)) ? 'block' : 'none';
}

function openModal(row, nullIdx) { document.getElementById('modal').style.display='flex'; const form = document.getElementById('modal-form'); form.dataset.editIndex = (row && row._docId) ? row._docId : (row ? nullIdx : ''); ['id','nome','categoria','subcategoria','sistema','fisico','situacao','data','motivo','resolvido'].forEach(k=>{ form.elements[k].value = (row && (row[k]||'')) || ''; }); }

function closeModal() { document.getElementById('modal').style.display='none'; }

async function onSaveRow(e) { e.preventDefault(); const form = e.target; const pdv = document.getElementById('pdv-select').value || PDVS[0]; const row = {}; ['id','nome','categoria','subcategoria','sistema','fisico','situacao','data','motivo','resolvido'].forEach(k=>row[k]=form.elements[k].value);
  if(useFirebase){ await saveToFirestore(pdv,row); await renderTable(); }else{ const rows = loadLocal(pdv); rows.unshift(row); saveLocal(pdv,rows); renderTable(); } closeModal(); }

async function onDelete(row, idx) { const pdv = document.getElementById('pdv-select').value || PDVS[0]; if(useFirebase){ if(row._docId) await deleteFromFirestore(row._docId); }else{ const rows = loadLocal(pdv); rows.splice(idx,1); saveLocal(pdv,rows); } renderTable(); }

function exportCSV() { const pdv = document.getElementById('pdv-select').value || PDVS[0]; const rows = loadLocal(pdv); const header = ['ID','NOME','CATEGORIA','SUB-CATEGORIA','SISTEMA','FISICO','SITUAÇÃO','DATA','MOTIVO','COMO FOI RESOLVIDO']; const lines = [header.join(',')].concat(rows.map(r=>[r.id||'',r.nome||'',r.categoria||'',r.subcategoria||'',r.sistema||'',r.fisico||'',r.situacao||'',r.data||'',`"${(r.motivo||'').replace(/"/g,'""') }"`,`"${(r.resolvido||'').replace(/"/g,'""') }"`].join(','))); const blob = new Blob([lines.join('\n')], {type:'text/csv'}); const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download = pdv.replace(/\s+/g,'_') + '_auditoria.csv'; a.click(); URL.revokeObjectURL(url); }

function exportXLSX() { const pdv = document.getElementById('pdv-select').value || PDVS[0]; const rows = loadLocal(pdv); const ws_data = [ ['ID','NOME','CATEGORIA','SUB-CATEGORIA','SISTEMA','FISICO','SITUAÇÃO','DATA','MOTIVO','COMO FOI RESOLVIDO'] ]; rows.forEach(r=> ws_data.push([r.id||'',r.nome||'',r.categoria||'',r.subcategoria||'',r.sistema||'',r.fisico||'',r.situacao||'',r.data||'',r.motivo||'',r.resolvido||''])); const wb = XLSX.utils.book_new(); const ws = XLSX.utils.aoa_to_sheet(ws_data); XLSX.utils.book_append_sheet(wb, ws, 'Auditoria'); const wbout = XLSX.write(wb, {bookType:'xlsx', type:'array'}); const blob = new Blob([wbout], {type:'application/octet-stream'}); const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href = url; a.download = pdv.replace(/\s+/g,'_') + '_auditoria.xlsx'; a.click(); URL.revokeObjectURL(url); }

function onFileInput(e) { const f = e.target.files[0]; if(!f) return; const reader = new FileReader(); reader.onload = function(ev) { const data = ev.target.result; const ext = f.name.split('.').pop().toLowerCase(); if(ext === 'csv') { // parse csv
    const text = data;
    parseCSVToRows(text);
  } else {
    const wb = XLSX.read(data, {type:'binary'});
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, {defval:''});
    importRows(rows);
  } }; if(f.name.split('.').pop().toLowerCase()==='csv') reader.readAsText(f); else reader.readAsBinaryString(f); }

function parseCSVToRowsSimple(text) { const lines = text.split(/\r?\n/).filter(Boolean); if(lines.length<1) return []; const header = lines[0].split(',').map(h=>h.trim()); const rows=[]; for(let i=1;i<lines.length;i++){ const cols = lines[i].split(','); const obj={}; header.forEach((h,idx)=> obj[h]=cols[idx]||''); rows.push(obj); } return rows; }

function parseCSVToRows(text) { const parsed = parseCSVToRowsSimple(text); importRows(parsed); }

function importRows(rows) { const pdv = document.getElementById('pdv-select').value || PDVS[0]; const mapped = rows.map(r=>({ id:r.id||r.ID||'', nome:r.nome||r.NOME||'', categoria:r.categoria||r.CATEGORIA||'', subcategoria:r.subcategoria||r['SUB-CATEGORIA']||r.subcategoria||'', sistema:r.sistema||r.SISTEMA||'', fisico:r.fisico||r.FISICO||'', situacao:r.situacao||r.SITUAÇÃO||'', data:r.data||r.DATA||'', motivo:r.motivo||r.MOTIVO||'', resolvido:r.resolvido||r['COMO FOI RESOLVIDO']||'' })); const existing = loadLocal(pdv); const combined = mapped.concat(existing); saveLocal(pdv,combined); renderTable(); alert('Importado ' + mapped.length + ' linhas para ' + pdv); }

function initCharts() { window.chartSituacao = new Chart(document.getElementById('chart-situacao').getContext('2d'), { type:'bar', data:{ labels:[], datasets:[{ label:'Situação', data:[] }]}, options:{ responsive:true } }); window.chartCategoria = new Chart(document.getElementById('chart-categoria').getContext('2d'), { type:'bar', data:{ labels:[], datasets:[{ label:'Categoria', data:[] }]}, options:{ responsive:true } }); }

function updateCharts(rows) { // situacao counts and categoria counts
  const situacaoCount = {};
  const categoriaCount = {};
  rows.forEach(r=>{ const s=r.situacao||'Não informado'; situacaoCount[s]= (situacaoCount[s]||0)+1; const c=r.categoria||'Não informado'; categoriaCount[c]= (categoriaCount[c]||0)+1; });
  const labelsS = Object.keys(situacaoCount); const dataS = labelsS.map(k=>situacaoCount[k]);
  window.chartSituacao.data.labels = labelsS; window.chartSituacao.data.datasets[0].data = dataS; window.chartSituacao.update();

  const labelsC = Object.keys(categoriaCount).slice(0,10); const dataC = labelsC.map(k=>categoriaCount[k]);
  window.chartCategoria.data.labels = labelsC; window.chartCategoria.data.datasets[0].data = dataC; window.chartCategoria.update();
}

function getActiveFilters() { const grid = document.getElementById('filters-grid'); const inputs = grid.querySelectorAll('input'); const res = {}; inputs.forEach(inp=>{ if(inp.value) res[inp.dataset.field]=inp.value; }); return res; }

function buildFilters() { const grid = document.getElementById('filters-grid'); grid.innerHTML=''; const fields = ['id','nome','categoria','subcategoria','sistema','fisico','situacao','data']; fields.forEach(f=>{ const div = document.createElement('div'); div.innerHTML = `<label>${f.toUpperCase()}<input data-field="${f}" placeholder="filtrar ${f}"></label>`; grid.appendChild(div); }); }

function clearFilters() { const grid = document.getElementById('filters-grid'); grid.querySelectorAll('input').forEach(i=>i.value=''); renderTable(); }

function clearLocalPDV() { if(!confirm('Limpar todos os dados locais deste PDV?')) return; const pdv = document.getElementById('pdv-select').value || PDVS[0]; localStorage.removeItem(getStorageKey(pdv)); renderTable(); alert('Dados locais limpos.'); }

function onDelete(row, idx) { if(!confirm('Excluir este registro?')) return; const pdv = document.getElementById('pdv-select').value || PDVS[0]; const rows = loadLocal(pdv); rows.splice(idx,1); saveLocal(pdv,rows); renderTable(); }

function onLoginClick() { if(useFirebase && auth){ const provider = new firebase.auth.GoogleAuthProvider(); auth.signInWithPopup(provider).catch(e=>alert('Erro login: '+e.message)); } else { const email = prompt('Digite seu e-mail (modo offline):'); if(email){ currentUser = { email }; updateAuthUI(); renderTable(); }} }

function onLogout() { if(useFirebase && auth) auth.signOut(); currentUser = null; updateAuthUI(); renderTable(); }
function updateAuthUI() { const ua=document.getElementById('user-area'); const loginBtn=document.getElementById('login-btn'); const logoutBtn=document.getElementById('logout-btn'); if(currentUser){ ua.textContent = currentUser.email || 'Usuário'; loginBtn.style.display='none'; logoutBtn.style.display='inline-block'; } else { ua.textContent=''; loginBtn.style.display='inline-block'; logoutBtn.style.display='none'; } }

window.addEventListener('load', init);
