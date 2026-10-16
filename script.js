// ===== Navegação mobile & smooth =====
const menuToggle = document.querySelector('.menu-toggle');
const navLinks = document.querySelector('.nav-links');
menuToggle?.addEventListener('click', () => {
  navLinks.classList.toggle('active');
  menuToggle.setAttribute('aria-expanded', String(navLinks.classList.contains('active')));
  const icon = menuToggle.querySelector('i');
  navLinks.classList.contains('active')
    ? icon.classList.replace('bx-menu', 'bx-x')
    : icon.classList.replace('bx-x', 'bx-menu');
});
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    e.preventDefault();
    const id = a.getAttribute('href');
    if (!id || id === '#') return;
    const t = document.querySelector(id);
    if (!t) return;
    window.scrollTo({ top: t.getBoundingClientRect().top + window.pageYOffset - 80, behavior: 'smooth' });
    navLinks?.classList.remove('active');
    menuToggle?.setAttribute('aria-expanded', 'false');
    menuToggle?.querySelector('i')?.classList.replace('bx-x', 'bx-menu');
  });
});

// ===== Estado =====
let ctx = {
  profissionalNome: null,
  profissionalId: null,
  profissionalDocId: null, // ✅ doc id em /profissionais/{id}
  wa: null,
  colecao: null,
  profKey: null,
  fimExpediente: null,
  diasFolga: null
};

let agendamentoContexto = {
  nomeCliente: '',
  sobrenomeCliente: '',
  telefoneCliente: '',
  produtos: [],
  totalProdutos: 0,
  servico: null // {nome, valor, tempoMin}
};

// ✅✅✅ AJUSTE CRÍTICO: pegar os elementos corretos do HTML
// (no HTML: <input id="data"> e <select id="hora">)
const dataInput = document.getElementById('data');
const horaSelect = document.getElementById('hora');

// ===== Constantes =====
const REVIEW_URL = document.getElementById('btnAvaliarGoogle')?.getAttribute('href') || '';

const SERVICOS = [
  // vazio (carrega do Firestore)
];

// ===== Dados dinâmicos (Firestore) =====
let HORARIO_FUNCIONAMENTO = { inicio: '09:00', fim: '18:30' }; // fallback
let SERVICOS_REMOTE = null;        // [{id,nome,valor,tempoMin}]
let PROFISSIONAIS_REMOTE = null;   // [{id,nome,fotoUrl,whatsapp,colecao,fimExpediente?,diasFolga?}]

const toBRL = (n) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// ===== Helpers (profissionalId) =====
function getProfIdFromCollection(col) {
  const c = (col || '').trim();
  if (!c) return null;
  if (c.startsWith('reservas_')) return c.replace(/^reservas_/, '').trim() || null;
  return null;
}

// ===== Helpers (nome para regras) =====
function getProfKeyFromName(nome) {
  const n = (nome || '').trim();
  if (!n) return null;
  // pega o primeiro nome (Rodrigo dos Anjos -> Rodrigo)
  return n.split(/\s+/)[0].trim();
}
function getFimExpedienteEfetivo() {
  // prioridade: ctx.fimExpediente (do Firestore/btn) -> mapa por primeiro nome -> horário global
  const key = ctx.profKey || getProfKeyFromName(ctx.profissionalNome) || null;
  if (ctx.fimExpediente) return ctx.fimExpediente;
  if (key && MAPA_FIM_EXPEDIENTE[key]) return MAPA_FIM_EXPEDIENTE[key];
  return HORARIO_FUNCIONAMENTO.fim || '18:30';
}
function getDiasFolgaEfetivo() {
  // prioridade: ctx.diasFolga (do Firestore/btn) -> mapa por primeiro nome -> []
  if (Array.isArray(ctx.diasFolga)) return ctx.diasFolga;
  const key = ctx.profKey || getProfKeyFromName(ctx.profissionalNome) || null;
  return (key && DIAS_FOLGA[key]) ? DIAS_FOLGA[key] : [];
}

// ===== Helpers de modal (ACESSÍVEIS) =====
let __lastActiveEl = null;

function __getFocusable(container) {
  return container.querySelectorAll(
    'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
  );
}
function __trapKeydown(e) {
  if (e.key !== 'Tab') return;
  const focusables = __getFocusable(e.currentTarget);
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault(); last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault(); first.focus();
  }
}
function abrirModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  __lastActiveEl = document.activeElement;

  el.style.display = 'flex';
  document.body.classList.add('modal-open');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.removeAttribute('aria-hidden');

  const focusables = __getFocusable(el);
  (focusables[0] || el).focus();

  el.addEventListener('keydown', __trapKeydown);

  el.__escHandler = (ev) => { if (ev.key === 'Escape') fecharModal(id); };
  document.addEventListener('keydown', el.__escHandler);
}
function fecharModal(id) {
  const el = document.getElementById(id);
  if (!el) return;

  el.style.display = 'none';
  document.body.classList.toggle('modal-open', [...document.querySelectorAll('.modal')].some(m => m.style.display === 'flex'));
  el.setAttribute('aria-hidden', 'true');
  el.removeAttribute('aria-modal');
  el.removeEventListener('keydown', __trapKeydown);

  if (el.__escHandler) {
    document.removeEventListener('keydown', el.__escHandler);
    delete el.__escHandler;
  }
  if (__lastActiveEl && typeof __lastActiveEl.focus === 'function') {
    __lastActiveEl.focus();
  }
}
window.fecharModal = fecharModal;

// ===== Persistência do agendamento =====
function salvarContextoSessao() {
  try {
    sessionStorage.setItem('agendamentoCtx', JSON.stringify(agendamentoContexto));
    sessionStorage.setItem('ctx', JSON.stringify(ctx));
  } catch { }
}
// ===== Fluxo Nome → Agendamento =====
const nomeClienteInput = document.getElementById('nomeCliente');
const sobrenomeClienteInput = document.getElementById('sobrenomeCliente');
const telefoneClienteInput = document.getElementById('telefoneCliente');

const onlyDigits = (s) => (s || '').replace(/\D/g, '');

document.getElementById('btnClienteContinuar')?.addEventListener('click', () => {
  const nome = (nomeClienteInput.value || '').trim();
  const sobrenome = (sobrenomeClienteInput.value || '').trim();
  const telefoneRaw = (telefoneClienteInput.value || '').trim();
  const telDigits = onlyDigits(telefoneRaw);

  if (!nome) { alert('Informe o nome.'); nomeClienteInput.focus(); return; }
  if (!sobrenome) { alert('Informe o sobrenome.'); sobrenomeClienteInput.focus(); return; }
  if (telDigits.length < 10 || telDigits.length > 13) {
    alert('Informe um telefone válido com DDD (ex.: 88996645739).');
    telefoneClienteInput.focus();
    return;
  }

  agendamentoContexto.nomeCliente = nome;
  agendamentoContexto.sobrenomeCliente = sobrenome;
  agendamentoContexto.telefoneCliente = telDigits.startsWith('55') ? telDigits : ('55' + telDigits);

  // ✅ AJUSTE: removido modal de produtos
  agendamentoContexto.produtos = [];
  agendamentoContexto.totalProdutos = 0;

  fecharModal('modalCliente');
  abrirModalAgendamento();
});

// STEP base para os horários (igual no admin)
let STEP_MIN = 25;

const MAPA_FIM_EXPEDIENTE = {};

const DIAS_FOLGA = {};

function folgaMsg(profNome) {
  const key = getProfKeyFromName(profNome) || profNome;
  if (key === 'João') return 'João Victor não atende às terças nem aos domingos. Por favor, escolha outro dia.';
  if (key === 'Rodrigo' || key === 'Melqui') return `${key} não atende aos domingos. Por favor, escolha outro dia.`;
  return 'Profissional indisponível para esta data. Escolha outro dia.';
}

const hhmmToMin = (hhmm) => {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number);
  return (h * 60) + (m || 0);
};
const minToHHMM = (min) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

function getServicoSelecionadoTempoMin() {
  const t = Number(agendamentoContexto?.servico?.tempoMin);
  return Number.isFinite(t) && t > 0 ? t : 30; // fallback
}

function gerarSlotsDoDia(inicioHHMM, fimHHMM, passoMin, duracaoMin) {
  const ini = hhmmToMin(inicioHHMM);
  const fim = hhmmToMin(fimHHMM);
  const ultimoInicio = fim - duracaoMin;
  const out = [];
  for (let t = ini; t <= ultimoInicio; t += passoMin) out.push(minToHHMM(t));
  return out;
}

// Compat: reagendamento
function fillHorasForProf(profNome, selectEl, duracaoMinOpt) {
  const dur = Number(duracaoMinOpt) || 30;
  const passo = STEP_MIN; // ✅ passo fixo

  const fimEfetivo = getFimExpedienteEfetivo();
  const lista = gerarSlotsDoDia(
    HORARIO_FUNCIONAMENTO.inicio || '09:00',
    fimEfetivo || '18:30',
    passo,
    dur
  );

  const target = selectEl || horaSelect;
  if (!target) return;

  target.innerHTML =
    `<option value="">Selecione um horário</option>` +
    lista.map(h => `<option value="${h}">${h}</option>`).join('');
}

function intervalosConflitam(aIni, aFim, bIni, bFim) {
  return aIni < bFim && bIni < aFim;
}


async function getReservasIntervalosByDate(colecao, ymd, ignoreId) {
  const result = await bookingCall({ action: 'availability', collection: colecao, date: ymd, ...(ignoreId ? { ignoreId } : {}) });
  return result.intervals;
}
async function getDisponibilidadeDia(ymd, profDocId) {
  return bookingCall({ action: 'availability', collection: ctx.colecao, date: ymd });
}
async function preencherHorasDisponiveis() {
  if (!horaSelect) return;
  const ymd = dataInput?.value;
  horaSelect.innerHTML = '<option value="">Selecione um horário</option>';
  if (!ymd || !ctx.colecao) return;
  try {
    const disp = await getDisponibilidadeDia(ymd, ctx.profissionalDocId);
    if (disp.fechado) { horaSelect.innerHTML = '<option value="">Indisponível nesta data</option>'; return; }
    const dur = getServicoSelecionadoTempoMin();
    const lista = gerarSlotsDoDia(disp.inicio, disp.fim, disp.intervalMin || STEP_MIN, dur);
    horaSelect.innerHTML += lista.map(h => '<option value="' + h + '">' + h + '</option>').join('');
    for (const opt of horaSelect.options) {
      if (!opt.value) continue;
      const ini = hhmmToMin(opt.value), fim = ini + dur;
      const disabled = disp.intervals.some(r => intervalosConflitam(ini, fim, r.ini, r.fim))
        || (disp.breakStart && disp.breakEnd && intervalosConflitam(ini, fim, hhmmToMin(disp.breakStart), hhmmToMin(disp.breakEnd)))
        || new Date(ymd + 'T' + opt.value + ':00-03:00').getTime() <= Date.now();
      opt.disabled = Boolean(disabled); opt.classList.toggle('reservado', Boolean(disabled));
    }
  } catch (error) {
    horaSelect.innerHTML = '<option value="">Não foi possível consultar os horários</option>';
    console.error('[Disponibilidade]', error);
  }
}
function resetSelectVisual(selectEl) { if (selectEl) selectEl.value = ''; }
function weekdayFromYMD(ymd) { return new Date(ymd + 'T12:00:00').getDay(); }
function dataPermitidaParaProf(ymd, profNome = ctx.profissionalNome) {
  if (!ymd) return true;
  const folgas = getDiasFolgaEfetivo();
  const w = weekdayFromYMD(ymd);
  return !folgas.includes(w);
}

async function abrirModalAgendamento() {
  if (!dataInput || !horaSelect) return;

  const hoje = new Date();
  const y = hoje.getFullYear();
  const m = String(hoje.getMonth() + 1).padStart(2, "0");
  const d = String(hoje.getDate()).padStart(2, "0");
  dataInput.min = `${y}-${m}-${d}`;
  dataInput.value = "";

  const folgas = getDiasFolgaEfetivo();
  if (folgas.length) dataInput.title = "Este profissional não atende em alguns dias da semana.";
  else dataInput.removeAttribute('title');

  await preencherHorasDisponiveis();

  horaSelect.value = "";
  resetSelectVisual(horaSelect);

  const display = document.getElementById('servicoDisplay');
  display.value = agendamentoContexto.servico
    ? `${agendamentoContexto.servico.nome} — ${toBRL(agendamentoContexto.servico.valor)}`
    : '';

  abrirModal('modal');
}

// Botões dos profissionais (agendar)
bindProfButtons();


dataInput?.addEventListener('change', preencherHorasDisponiveis);

// ===== Conexão compartilhada com o painel =====
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js';
const firebaseConfig = {
  apiKey: "AIzaSyBTXqQuzZkzHnQVfiyb4gvSi9xkB5eAeLg",
  authDomain: "ws-barber-5a702.firebaseapp.com",
  projectId: "ws-barber-5a702",
  storageBucket: "ws-barber-5a702.firebasestorage.app",
  messagingSenderId: "938889878022",
  appId: "1:938889878022:web:873aaee9b664c10e9b8187"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const callable = httpsCallable(getFunctions(app, 'southamerica-east1'), 'bookingApi');
let sessionReady;
async function bookingCall(data) {
  if (!sessionReady) sessionReady = (async () => {
    await auth.authStateReady();
    if (!auth.currentUser) await signInAnonymously(auth);
  })().catch(error => { sessionReady = null; throw error; });
  await sessionReady;
  return (await callable(data)).data;
}
// Adaptadores somente para os documentos públicos de configuração.
const db = null;
const doc = (_db, ...parts) => ({ path: parts.join('/'), id: parts.at(-1) });
const collection = (_db, name) => name;
async function getDoc(reference) {
  const data = await bookingCall({ action: 'document', path: reference.path });
  return { exists: () => data !== null, data: () => data };
}
async function getDocs(name) {
  const rows = await bookingCall({ action: 'list', collection: name });
  return rows.map(row => ({ id: row.id, data: () => row }));
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

// ===== Carregar Config/Serviços/Profissionais do Firestore =====
async function carregarHorarioFuncionamento() {
  try {
    const ref = doc(db, 'config', 'horarios');
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const d = snap.data() || {};
      STEP_MIN = Number(d.intervalMin ?? d.intervaloMin ?? 25) || 25;
      if (d.inicio) HORARIO_FUNCIONAMENTO.inicio = d.inicio;
      if (d.fim) HORARIO_FUNCIONAMENTO.fim = d.fim;
    }
  } catch (e) {
    console.warn('[CFG] Não foi possível carregar horário de funcionamento:', e);
  }
  const elTxt = document.getElementById('horarioFuncionamentoTexto');
  if (elTxt) {
    elTxt.textContent = `Seg-Sáb: ${HORARIO_FUNCIONAMENTO.inicio} às ${HORARIO_FUNCIONAMENTO.fim}`;
  }
}

async function carregarServicos() {
  try {
    const snap = await getDocs(collection(db, 'servicos'));
    const arr = [];
    snap.forEach(docu => {
      const d = docu.data() || {};
      arr.push({
        id: docu.id,
        nome: (d.nome || d.servicoNome || '').trim(),
        valor: Number(d.valor ?? d.preco ?? d.servicoValor ?? 0),
        tempoMin: Number(d.tempoMin ?? d.tempo ?? d.duracaoMin ?? 30),
      });
    });
    arr.sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
    SERVICOS_REMOTE = arr.filter(s => s.nome);
  } catch (e) {
    console.warn('[SERVICOS] Não foi possível carregar serviços:', e);
    SERVICOS_REMOTE = null;
  }
}

async function carregarProfissionais() {
  try {
    const snap = await getDocs(collection(db, 'profissionais'));
    const arr = [];
    snap.forEach(docu => {
      const d = docu.data() || {};
      arr.push({
        id: docu.id,
        nome: (d.nome || '').trim(),
        fotoUrl: (d.fotoUrl || d.foto || '').trim(),
        whatsapp: (d.whatsapp || d.wa || '').trim(),
        colecao: (d.colecao || d.collection || (d.slug ? `reservas_${d.slug}` : '')).trim(),

        // ✅ NOVO: opcional por profissional
        fimExpediente: (d.fimExpediente || d.fim || d.horarioFim || '').trim() || null,
        diasFolga: Array.isArray(d.diasFolga) ? d.diasFolga : (Array.isArray(d.folgas) ? d.folgas : null),
      });
    });
    arr.sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
    PROFISSIONAIS_REMOTE = arr.filter(p => p.nome && p.colecao);
  } catch (e) {
    console.warn('[PROFISSIONAIS] Não foi possível carregar profissionais:', e);
    PROFISSIONAIS_REMOTE = null;
  }
}

function getServicosAtivos() {
  const base = Array.isArray(SERVICOS_REMOTE) && SERVICOS_REMOTE.length
    ? SERVICOS_REMOTE.map(s => ({ id: s.id, nome: s.nome, valor: s.valor, tempoMin: s.tempoMin }))
    : SERVICOS.slice(1).map(s => ({ ...s, tempoMin: s.tempoMin ?? 30 }));

  return [{ nome: 'Selecionar...', valor: null, tempoMin: null, placeholder: true }, ...base];
}

function renderProfissionaisNoSite() {
  const container = document.getElementById('profissionaisContainer');
  if (!container) return;

  const lista = Array.isArray(PROFISSIONAIS_REMOTE) && PROFISSIONAIS_REMOTE.length
    ? PROFISSIONAIS_REMOTE
    : [];

  container.textContent = lista.length ? '' : 'Nenhum profissional disponível. Se necessário, entre em contato com a barbearia.';

  lista.forEach((p) => {
    const card = document.createElement('div');
    card.className = 'haircut';

    const dataFim = p.fimExpediente ? `data-fim="${escapeHtml(p.fimExpediente)}"` : '';
    const dataFolga = Array.isArray(p.diasFolga) ? `data-folgas='${escapeHtml(JSON.stringify(p.diasFolga))}'` : '';

    // ✅ AJUSTE: FECHAR OS BOTÕES CORRETAMENTE
    card.innerHTML = `
      <img src="${escapeHtml(p.fotoUrl || './assets/logo-ra-baberaria1.png')}" alt="${escapeHtml(p.nome)}" class="service-img" loading="lazy">
      <div class="haircut-info">
        <strong>${escapeHtml(p.nome)}</strong>
        <div class="btn-actions">

          <button class="button-contact openModalBtn"
            data-pro="${escapeHtml(p.nome)}"
            data-prodoc="${escapeHtml(p.id || '')}"
            data-wa="${escapeHtml(p.whatsapp || '')}"
            data-col="${escapeHtml(p.colecao)}"
            ${dataFim}
            ${dataFolga}
          >
            <i class='bx bx-calendar'></i> Agende Seu Horário
          </button>

          <button class="button-secondary openReagendaBtn"
            data-pro="${escapeHtml(p.nome)}"
            data-prodoc="${escapeHtml(p.id || '')}"
            data-wa="${escapeHtml(p.whatsapp || '')}"
            data-col="${escapeHtml(p.colecao)}"
            ${dataFim}
            ${dataFolga}
          >
            <i class='bx bx-refresh'></i> Reagendar seu horário
          </button>

        </div>
      </div>
    `;
    container.appendChild(card);
  });

  bindProfButtons();
  bindReagendaButtons(); // ✅ AJUSTE: garantir bind após render
}

// separa o bind para reusar após render
function bindProfButtons() {
  document.querySelectorAll('.openModalBtn').forEach(btn => {
    if (btn.__bound) return;
    btn.__bound = true;
    btn.addEventListener('click', () => {
      ctx.profissionalNome = (btn.dataset.pro || 'Profissional').trim();
      ctx.profissionalDocId = (btn.dataset.prodoc || '').trim() || null;

      ctx.profKey = getProfKeyFromName(ctx.profissionalNome);
      ctx.wa = (btn.dataset.wa || '5581999999999').trim();
      ctx.colecao = (btn.dataset.col || 'reservas').trim();
      ctx.profissionalId = getProfIdFromCollection(ctx.colecao) || null;

      // ✅ NOVO: fim e folgas por profissional via dataset
      ctx.fimExpediente = (btn.dataset.fim || '').trim() || null;
      try {
        ctx.diasFolga = btn.dataset.folgas ? JSON.parse(btn.dataset.folgas) : null;
      } catch {
        ctx.diasFolga = null;
      }

      // se trocou profissional, revalidar data/hora (evita ficar selecionado algo inválido)
      if (dataInput?.value) {
        // recalcula horas com fim novo
        preencherHorasDisponiveis();
      }

      salvarContextoSessao();
      abrirModal('modalCliente');
    });
  });

  // seu reagendamento (abaixo) usa querySelectorAll('.openReagendaBtn') mais embaixo
}

// ✅ AJUSTE: bind do reagendamento precisa acontecer depois que os botões existem no DOM
function bindReagendaButtons() {
  document.querySelectorAll('.openReagendaBtn').forEach(btn => {
    if (btn.__bound) return;
    btn.__bound = true;

    btn.addEventListener('click', () => {
      ctx.profissionalNome = (btn.dataset.pro || 'Profissional').trim();
      ctx.profissionalDocId = (btn.dataset.prodoc || '').trim() || null;

      ctx.profKey = getProfKeyFromName(ctx.profissionalNome);
      ctx.wa = (btn.dataset.wa || '5581999999999').trim();
      ctx.colecao = (btn.dataset.col || 'reservas').trim();
      ctx.profissionalId = getProfIdFromCollection(ctx.colecao) || null;

      ctx.fimExpediente = (btn.dataset.fim || '').trim() || null;
      try {
        ctx.diasFolga = btn.dataset.folgas ? JSON.parse(btn.dataset.folgas) : null;
      } catch {
        ctx.diasFolga = null;
      }

      // prepara modal
      reaResultados.innerHTML = '';
      reaStepBusca.classList.remove('hidden');
      reaStepMover.classList.add('hidden');
      reaNome.value = '';
      reaSobrenome.value = '';

      abrirModal('modalReagendar');
    });
  });
}

// Inicialização do site (dados dinâmicos)
(async function initSite() {
  await Promise.all([
    carregarHorarioFuncionamento(),
    carregarServicos(),
    carregarProfissionais(),
  ]);
  renderProfissionaisNoSite();
})();

const confirmarBtn = document.getElementById('confirmarBtn');
const toKey = (ymd, hhmm) => `${ymd}_${hhmm}`;
const normalizeHora = (h) => (h || '').padStart(5, "0");

// ---- consultar horários ocupados para a data
async function getReservasByDate(colecao, ymd) {
  const result = await bookingCall({ action: 'availability', collection: colecao, date: ymd });
  return new Set(result.intervals.map(row => minToHHMM(row.ini)));
}

async function carregarIndisponiveis() {
  await preencherHorasDisponiveis();
}

dataInput?.addEventListener('input', async () => {
  if (!dataInput.value) return;

  try {
    const disp = await getDisponibilidadeDia(dataInput.value, ctx.profissionalDocId);
    if (disp?.fechado === true) {
      alert('Indisponível nesta data. Escolha outro dia.');
      dataInput.value = "";
      resetSelectVisual(horaSelect);
      horaSelect.value = "";
    }
  } catch {
    // se falhar, não trava o usuário aqui — deixa o preencherHorasDisponiveis lidar
  }
});

// ===== Modal de Serviço =====
const servicoDisplay = document.getElementById('servicoDisplay');
const servicoLista = document.getElementById('servicoLista');
const servicoCancelar = document.getElementById('servicoCancelar');
const servicoConfirmarWpp = document.getElementById('servicoConfirmarWpp');

const svcSearch = document.getElementById('svcSearch');
let svcFilterText = "";
const norm = (s) => (s || "").normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function getFilteredServicos() {
  const base = getServicosAtivos().slice(1);
  if (!svcFilterText.trim()) return [{ nome: 'Selecionar...', valor: null, placeholder: true }, ...base];
  const f = norm(svcFilterText);
  const filtered = base.filter(s => norm(s.nome).includes(f));
  return [{ nome: 'Selecionar...', valor: null, placeholder: true }, ...filtered];
}

function renderListaServicos() {
  const items = getFilteredServicos();
  servicoLista.innerHTML = items.map((s) => {
    const checked = agendamentoContexto.servico
      ? (agendamentoContexto.servico.nome === s.nome ? 'checked' : '')
      : (s.placeholder ? 'checked' : '');
    const sub = s.placeholder ? '' : `<div class="svc-muted">${s.valor != null ? toBRL(s.valor) : ''}</div>`;
    return `
      <label class="svc-row" data-nome="${escapeHtml(s.nome)}">
        <div class="svc-left">
          <div class="svc-name">${escapeHtml(s.nome)}</div>
          ${sub}
        </div>
        <input class="svc-radio" type="radio" name="svc" value="${escapeHtml(s.nome)}" ${checked} />
      </label>
    `;
  }).join('');

  servicoLista.querySelectorAll('.svc-row').forEach(row => {
    row.addEventListener('click', () => {
      const radio = row.querySelector('input[type="radio"]');
      if (!radio) return;
      radio.checked = true;
    });
  });
}

async function abrirServico() {
  // ✅ garante serviços remotos carregados (evita parecer que não filtra)
  if (!SERVICOS_REMOTE) {
    await carregarServicos();
  }

  svcFilterText = "";
  if (svcSearch) svcSearch.value = "";
  renderListaServicos();
  abrirModal('servicoModal');
}

servicoDisplay?.addEventListener('click', () => { abrirServico(); });
servicoCancelar?.addEventListener('click', () => fecharModal('servicoModal'));
svcSearch?.addEventListener('input', (e) => { svcFilterText = e.target.value || ""; renderListaServicos(); });

servicoConfirmarWpp?.addEventListener('click', async () => {
  const sel = servicoLista.querySelector('input[name="svc"]:checked');
  if (!sel) { alert('Selecione um serviço.'); return; }
  const nomeSel = sel.value;
  const s = getServicosAtivos().find(x => x.nome === nomeSel);
  if (!s || s.placeholder) { alert('Selecione um serviço.'); return; }

  agendamentoContexto.servico = { id: s.id, nome: s.nome, valor: s.valor, tempoMin: s.tempoMin ?? 30 };
  servicoDisplay.value = `${s.nome} — ${toBRL(s.valor)}`;
  fecharModal('servicoModal');

  await preencherHorasDisponiveis();

  if (dataInput.value && horaSelect.value) {
    confirmarBtn.click();
  }
});

// ===== Confirmar agendamento =====
const confResumo = document.getElementById('confResumo');
const btnOkConfirmacao = document.getElementById('btnOkConfirmacao');
btnOkConfirmacao?.addEventListener('click', () => fecharModal('modalConfirmacao'));

confirmarBtn?.addEventListener('click', async () => {
  const data = dataInput?.value;
  const hora = horaSelect?.value;
  if (!data || !hora) { alert("Selecione data e horário."); return; }

  if (!dataPermitidaParaProf(data, ctx.profissionalNome)) {
    alert(folgaMsg(ctx.profissionalNome));
    return;
  }

  if (!(agendamentoContexto.nomeCliente && agendamentoContexto.sobrenomeCliente)) {
    alert("Informe nome e sobrenome.");
    abrirModal('modalCliente');
    return;
  }
  if (!agendamentoContexto.telefoneCliente || agendamentoContexto.telefoneCliente.length < 12) {
    alert("Informe um telefone válido com DDD.");
    abrirModal('modalCliente');
    return;
  }

  if (!agendamentoContexto.servico) { alert("Selecione o serviço."); abrirServico(); return; }
  if (!ctx.colecao) { alert("Profissional não definido."); return; }
  if (!ctx.profissionalId) ctx.profissionalId = getProfIdFromCollection(ctx.colecao) || null;

  confirmarBtn.disabled = true;
  const originalText = confirmarBtn.textContent;
  confirmarBtn.textContent = "Reservando...";

  try {
    const hhmm = normalizeHora(hora);
    const col = (ctx.colecao || '').trim();
    const nomeCompleto = [agendamentoContexto.nomeCliente, agendamentoContexto.sobrenomeCliente].join(' ').trim();
    await bookingCall({
      action: 'create', collection: col, date: data, time: hhmm,
      serviceId: agendamentoContexto.servico.id,
      name: agendamentoContexto.nomeCliente, surname: agendamentoContexto.sobrenomeCliente,
      phone: agendamentoContexto.telefoneCliente
    });

    await carregarIndisponiveis();

    const dataBR = new Date(`${data}T00:00:00`).toLocaleDateString('pt-BR');
    const servicoTxt = agendamentoContexto.servico
      ? `${agendamentoContexto.servico.nome} (${toBRL(agendamentoContexto.servico.valor)})`
      : '—';

    if (confResumo) {
      confResumo.innerHTML = `
        <div class="line"><span class="label">Cliente:</span><span>${escapeHtml(nomeCompleto)}</span></div>
        <div class="line"><span class="label">Profissional:</span><span>${escapeHtml(ctx.profissionalNome)}</span></div>
        <div class="line"><span class="label">Data:</span><span>${dataBR}</span></div>
        <div class="line"><span class="label">Hora:</span><span>${hhmm}</span></div>
        <div class="line"><span class="label">Serviço:</span><span>${escapeHtml(servicoTxt)}</span></div>
      `;
    }
    fecharModal('modal');
    abrirModal('modalConfirmacao');
  } catch (err) {
    console.error("[RESERVA]", err);
    alert(err.message || "Não foi possível concluir a reserva. Tente novamente.");
  } finally {
    confirmarBtn.disabled = false;
    confirmarBtn.textContent = originalText || "Agendar";
  }
});

// Util
function formatDateBR(ymd) {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}

// Fechar modal clicando fora
window.addEventListener('click', (e) => {
  document.querySelectorAll('.modal').forEach(m => {
    if (e.target === m) fecharModal(m.id);
  });
});


// ---------------------------------------------------------------------
//        REAGENDAMENTO (ATÔMICO: guarda a DocumentReference)
// ---------------------------------------------------------------------
const reaStepBusca = document.getElementById('reaStepBusca');
const reaStepMover = document.getElementById('reaStepMover');
const reaNome = document.getElementById('reaNome');
const reaSobrenome = document.getElementById('reaSobrenome');
const reaBuscarBtn = document.getElementById('reaBuscarBtn');
const reaResultados = document.getElementById('reaResultados');
const reaEscolhido = document.getElementById('reaEscolhido');
const reaData = document.getElementById('reaData');
const reaHora = document.getElementById('reaHora');
const reaConfirmarBtn = document.getElementById('reaConfirmarBtn');

let reservaSelecionada = null;

// Os cartões dinâmicos são vinculados em bindReagendaButtons.

async function buscarAgendamentosPorNome(colecao, nomeLower, sobrenomeLower) {
  const rows = await bookingCall({ action: 'search', collection: colecao, name: nomeLower, surname: sobrenomeLower });
  return rows.map(row => ({ ...row, ref: { id: row.id } }));
}

function renderResultados(list) {
  if (!list.length) {
    reaResultados.innerHTML = `<div class="muted">Nenhum agendamento desta sessão encontrado. Use o mesmo navegador em que agendou ou fale com a barbearia.</div>`;
    return;
  }
  list.sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora));
  reaResultados.innerHTML = list.map((r, idx) => `
    <div class="rea-item">
      <div class="rea-line"><strong>Data:</strong> ${formatDateBR(r.data)} • <strong>Hora:</strong> ${r.hora}</div>
      <div class="rea-line"><strong>Serviço:</strong> ${escapeHtml(r.servicoNome || '—')}</div>
      <button type="button" data-i="${idx}" class="reaSelectBtn">Selecionar</button>
    </div>
  `).join('');

  document.querySelectorAll('.reaSelectBtn').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.i);
      const chosen = list[i];
      reservaSelecionada = {
        idAntigo: chosen.id,
        refAntigo: chosen.ref,
        dataAntiga: chosen.data,
        horaAntiga: chosen.hora,
        docData: chosen
      };

      const hoje = new Date();
      const y = hoje.getFullYear();
      const m = String(hoje.getMonth() + 1).padStart(2, "0");
      const d = String(hoje.getDate()).padStart(2, "0");
      reaData.min = `${y}-${m}-${d}`;
      reaData.value = '';

      reaEscolhido.innerHTML = `
        <strong>Agendamento atual:</strong> ${formatDateBR(chosen.data)} às ${chosen.hora}
        ${chosen.servicoNome ? ` • ${escapeHtml(chosen.servicoNome)}` : ''}
      `;

      fillHorasForProf(
        ctx.profissionalNome,
        reaHora,
        reservaSelecionada?.docData?.servicoTempoMin || 30
      );

      resetSelectVisual(reaHora);

      reaStepBusca.classList.add('hidden');
      reaStepMover.classList.remove('hidden');
    });
  });
}

reaBuscarBtn?.addEventListener('click', async () => {
  const nome = (reaNome.value || '').trim().toLowerCase();
  const sobrenome = (reaSobrenome.value || '').trim().toLowerCase();

  if (!nome || !sobrenome) {
    alert('Informe nome e sobrenome para buscar.');
    return;
  }
  if (!ctx.colecao) { alert('Profissional não definido.'); return; }

  try {
    reaResultados.innerHTML = 'Carregando...';
    const itens = await buscarAgendamentosPorNome(ctx.colecao, nome, sobrenome);
    renderResultados(itens);
  } catch (e) {
    console.error('[Reagendar][buscar]', e);
    reaResultados.innerHTML = '<div class="muted">Erro ao buscar. Tente novamente.</div>';
  }
});

reaData?.addEventListener('change', async () => {
  if (!reaData.value) return;

  const ymd = reaData.value;
  const dur = Number(reservaSelecionada?.docData?.servicoTempoMin) || 30;
  let disp;

  // 1) disponibilidade do dia (semana + exceções)
  try {
    disp = await getDisponibilidadeDia(ymd, ctx.profissionalDocId);
    if (disp?.fechado === true) {
      alert('Indisponível nesta data. Escolha outro dia.');
      reaData.value = '';
      resetSelectVisual(reaHora);
      reaHora.value = '';
      return;
    }
  } catch {
    reaHora.innerHTML = '<option value="">Não foi possível consultar os horários</option>';
    return;
  }

  // 2) gera slots válidos para a duração do serviço
  const inicioEfetivo = disp.inicio;
  const fimEfetivo = disp.fim;

  const lista = gerarSlotsDoDia(inicioEfetivo, fimEfetivo, disp.intervalMin || STEP_MIN, dur);

  reaHora.innerHTML =
    `<option value="">Selecione um horário</option>` +
    lista.map(h => `<option value="${h}">${h}</option>`).join('');

  // 3) bloqueia por conflito de intervalo
  try {
    const reservas = await getReservasIntervalosByDate(ctx.colecao, ymd, reservaSelecionada.idAntigo);

    for (const opt of reaHora.options) {
      const val = opt.value;
      if (!val) continue;

      const ini = hhmmToMin(val);
      const fim = ini + dur;

      const conflita = reservas.some(r => intervalosConflitam(ini, fim, r.ini, r.fim));


      const disabled = conflita
        || (disp.breakStart && disp.breakEnd && intervalosConflitam(ini, fim, hhmmToMin(disp.breakStart), hhmmToMin(disp.breakEnd)))
        || new Date(ymd + 'T' + val + ':00-03:00').getTime() <= Date.now();
      opt.disabled = disabled;
      opt.classList.toggle('reservado', disabled);
    }
  } catch (e) {
    reaHora.innerHTML = '<option value="">Não foi possível consultar os horários</option>';
    console.error('[Reagendar][disponibilidade]', e);
    alert('Não foi possível consultar horários desta data.');
  }
});



reaConfirmarBtn?.addEventListener('click', async () => {
  if (!reservaSelecionada || !reservaSelecionada.refAntigo) {
    alert('Selecione um agendamento para reagendar.');
    return;
  }
  const novaData = reaData.value;
  const novaHora = normalizeHora(reaHora.value);

  if (!novaData || !novaHora) { alert('Selecione a nova data e hora.'); return; }
  if (!dataPermitidaParaProf(novaData, ctx.profissionalNome)) { alert(folgaMsg(ctx.profissionalNome)); return; }

  const col = (ctx.colecao || '').trim();

  reaConfirmarBtn.disabled = true;
  try {
    await bookingCall({ action: 'move', collection: col, id: reservaSelecionada.idAntigo, date: novaData, time: novaHora });
  } catch (error) {
    alert(error.message || 'Não foi possível reagendar.');
    return;
  } finally {
    reaConfirmarBtn.disabled = false;
  }


  try {
    const base = reservaSelecionada.docData || {};
    const dataBR = new Date(`${novaData}T00:00:00`).toLocaleDateString('pt-BR');
    if (confResumo) {
      confResumo.innerHTML = `
        <div class="line"><span class="label">Cliente:</span><span>${escapeHtml(base.clienteNomeCompleto || (base.clienteNome + ' ' + base.clienteSobrenome))}</span></div>
        <div class="line"><span class="label">Profissional:</span><span>${escapeHtml(ctx.profissionalNome)}</span></div>
        <div class="line"><span class="label">Nova data:</span><span>${dataBR}</span></div>
        <div class="line"><span class="label">Nova hora:</span><span>${novaHora}</span></div>
        <div class="line"><span class="label">Serviço:</span><span>${escapeHtml(base.servicoNome || '—')}</span></div>
      `;
    }
    fecharModal('modalReagendar');
    abrirModal('modalConfirmacao');
  } catch (e) {
    console.error('[Reagendar][resumo]', e);
  }
});

// Presentation enhancements: optional animation with reduced-motion support.
document.getElementById('currentYear').textContent = new Date().getFullYear();
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
if ('IntersectionObserver' in window && !reduceMotion.matches) {
  const revealObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.remove('pending'); revealObserver.unobserve(entry.target); } });
  }, { threshold: 0.08 });
  document.querySelectorAll('.reveal').forEach(el => { el.classList.add('pending'); revealObserver.observe(el); });
}
document.querySelectorAll('.close, .svc-close').forEach(el => {
  const button = document.createElement('button');
  button.type = 'button'; button.className = el.className;
  button.setAttribute('aria-label', 'Fechar janela');
  button.textContent = '×'; button.addEventListener('click', () => fecharModal(el.closest('.modal').id));
  el.replaceWith(button);
});
document.querySelectorAll('.modal-content').forEach((dialog, index) => {
  const title = dialog.querySelector('h2, .svc-title');
  if (title) { title.id ||= 'dialog-title-' + index; dialog.setAttribute('aria-labelledby', title.id); }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && navLinks?.classList.contains('active')) {
    navLinks.classList.remove('active'); menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.querySelector('i')?.classList.replace('bx-x', 'bx-menu'); menuToggle.focus();
  }
});
