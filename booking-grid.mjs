export const GRID_MINUTES = 5;
export function minutes(time) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time))) throw new Error('Horário inválido.');
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
}
export function slotKeys(booking) {
  const start = minutes(booking.hora);
  const duration = Number(booking.servicoTempoMin ?? booking.tempoMin ?? booking.duracaoMin ?? 30);
  if (!Number.isFinite(duration) || duration <= 0 || start + duration > 1440) throw new Error('Duração inválida.');
  const result = [];
  for (let n = Math.floor(start / 5) * 5; n < start + duration; n += 5) result.push(String(n));
  return result;
}
export function releaseSlots(slots, id) {
  return Object.fromEntries(Object.entries(slots).filter(([, value]) => value !== id));
}
export function claimSlots(slots, id, booking) {
  const next = { ...slots };
  for (const key of slotKeys(booking)) {
    if (next[key]) throw new Error('Este horário conflita com outro atendimento ou bloqueio.');
    next[key] = id;
  }
  return next;
}
export function busyIntervals(slots, ignoreId) {
  return Object.entries(slots).filter(([, id]) => id !== ignoreId).map(([key]) => ({ ini: Number(key), fim: Number(key) + 5 }));
}
