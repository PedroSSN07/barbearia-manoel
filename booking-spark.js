import { getFirestore, doc, collection, getDoc, getDocs, query, where, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { claimSlots, releaseSlots, busyIntervals, minutes, slotKeys } from './booking-grid.mjs';

export function createBookingClient(app, auth, ready) {
  const db = getFirestore(app);
  const dayRef = (col, date) => doc(db, 'agenda_publica', col, 'dias', date);
  async function settings(col, date) {
    const profs = await getDocs(query(collection(db, 'profissionais'), where('colecao', '==', col)));
    const professional = profs.docs.find(p => p.data().ativo !== false);
    if (!professional) throw new Error('Profissional indisponível.');
    const refs = ['config/semana', 'config/horarios', `config/excecoes/dias/${date}`, `profissionais/${professional.id}/excecoes/${date}`];
    const snapshots = await Promise.all(refs.map(path => getDoc(doc(db, path))));
    const [week, hours, general, exception] = snapshots.map(s => s.data() || {});
    const p = professional.data();
    const wd = new Date(`${date}T12:00:00-03:00`).getDay();
    return {
      professional: { ...p, id: professional.id },
      fechado: general.fechado === true || exception.fechado === true
        || (!(week.weekdays || [1,2,3,4,5]).includes(wd) && !(general.inicio && general.fim) && !(exception.inicio && exception.fim))
        || (p.diasFolga || []).includes(wd),
      inicio: exception.inicio || general.inicio || week.dayStart || hours.inicio || '09:00',
      fim: exception.fim || general.fim || p.fimExpediente || week.dayEnd || hours.fim || '19:00',
      intervalMin: Number(hours.intervalMin ?? 25), breakStart: hours.breakStart || '', breakEnd: hours.breakEnd || ''
    };
  }
  return async input => {
    await ready();
    if (input.action === 'list') {
      if (!['servicos', 'profissionais'].includes(input.collection)) throw new Error('Consulta inválida.');
      const snap = await getDocs(collection(db, input.collection));
      return snap.docs.filter(d => d.data().ativo !== false).map(d => ({ ...d.data(), id: d.id }));
    }
    if (input.action === 'document') {
      const snap = await getDoc(doc(db, input.path));
      return snap.data() || null;
    }
    const col = input.collection;
    if (!/^reservas_[a-z0-9_]+$/.test(col || '')) throw new Error('Profissional inválido.');
    if (input.action === 'search') {
      const snap = await getDocs(query(collection(db, col), where('ownerUid', '==', auth.currentUser.uid)));
      return snap.docs.filter(d => d.data().clienteNomeLower === input.name && d.data().clienteSobrenomeLower === input.surname).map(d => ({ ...d.data(), id: d.id }));
    }
    const marker = await getDoc(doc(db, 'public_booking', 'config'));
    if (!marker.data()?.ready) throw new Error('A agenda online ainda está sendo preparada. Entre em contato com a barbearia.');
    const date = input.date;
    const availability = await settings(col, date);
    if (input.action === 'availability') {
      const snap = await getDoc(dayRef(col, date));
      let ignored;
      if (input.ignoreId) {
        const own = await getDoc(doc(db, col, input.ignoreId));
        if (own.data()?.ownerUid === auth.currentUser.uid) ignored = input.ignoreId;
      }
      return { ...availability, professional: undefined, intervals: busyIntervals(snap.data()?.slots || {}, ignored) };
    }
    if (!['create', 'move'].includes(input.action)) throw new Error('Operação inválida.');
    const start = minutes(input.time);
    const target = doc(db, col, `${date}_${input.time}`);
    const oldRef = input.action === 'move' ? doc(db, col, input.id) : null;
    if (oldRef?.path === target.path) return { id: target.id };
    return runTransaction(db, async tx => {
      let data;
      if (oldRef) {
        const old = await tx.get(oldRef);
        if (!old.exists() || old.data().ownerUid !== auth.currentUser.uid) throw new Error('Reserva não encontrada nesta sessão.');
        data = old.data();
      } else {
        const service = await tx.get(doc(db, 'servicos', input.serviceId));
        if (!service.exists() || service.data().ativo === false) throw new Error('Serviço indisponível.');
        const s = service.data();
        const name = String(input.name || '').trim(), surname = String(input.surname || '').trim();
        data = {
          ownerUid: auth.currentUser.uid, profissionalDocId: availability.professional.id,
          clienteNome: name, clienteSobrenome: surname, clienteNomeCompleto: `${name} ${surname}`,
          clienteNomeLower: name.toLowerCase(), clienteSobrenomeLower: surname.toLowerCase(),
          clienteTelefone: String(input.phone || '').replace(/\D/g, ''),
          servicoId: service.id, servicoNome: s.nome, servicoValor: Number(s.valor), servicoTempoMin: Number(s.tempoMin || 30),
          origem: 'site', status: 'pendente', createdAt: serverTimestamp(),
          raclub: { status: 'nao' }, raclubMembro: false, clienteTipo: 'cliente', tags: [], produtos: [], totalProdutos: 0
        };
      }
      const duration = Number(data.servicoTempoMin);
      if (!Number.isInteger(duration) || duration < 5 || duration > 180 || duration % 5 || start % 5) throw new Error('O agendamento online aceita serviços de 5 a 180 minutos, em múltiplos de 5. Fale com a barbearia.');
      if (availability.fechado || start < minutes(availability.inicio) || start + duration > minutes(availability.fim)) throw new Error('Horário fora do expediente.');
      if ((start - minutes(availability.inicio)) % availability.intervalMin) throw new Error('Horário fora da grade de atendimento.');
      if (availability.breakStart && availability.breakEnd && start < minutes(availability.breakEnd) && minutes(availability.breakStart) < start + duration) throw new Error('Horário reservado para intervalo.');
      if (new Date(`${date}T${input.time}:00-03:00`).getTime() <= Date.now()) throw new Error('Escolha um horário futuro.');
      const destination = dayRef(col, date);
      const origin = oldRef ? dayRef(col, data.data) : destination;
      const [before, after] = await Promise.all([tx.get(origin), tx.get(destination)]);
      const same = origin.path === destination.path;
      const released = releaseSlots(before.data()?.slots || {}, oldRef?.id);
      const payload = { ...data, data: date, hora: input.time, startMin: start, profissional: availability.professional.nome, profissionalNome: availability.professional.nome, updatedAt: serverTimestamp() };
      const slots = claimSlots(same ? released : after.data()?.slots || {}, target.id, payload);
      const release = oldRef ? Object.fromEntries(slotKeys(data).map(key => [key, oldRef.id])) : {};
      const claim = Object.fromEntries(slotKeys(payload).map(key => [key, target.id]));
      if (!same) tx.set(origin, { slots: released, claimId: '', releaseId: oldRef.id, claim: {}, release, updatedAt: serverTimestamp() });
      tx.set(destination, { slots, claimId: target.id, releaseId: same && oldRef ? oldRef.id : '', claim, release: same ? release : {}, updatedAt: serverTimestamp() });
      tx.set(target, payload);
      if (oldRef) tx.delete(oldRef);
      return { id: target.id };
    });
  };
}
