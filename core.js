// Shared, side-effect-free rules used by the UI and backup reader.
export const AUDIO_TYPES = {mp3:'audio/mpeg', m4a:'audio/mp4', mp4:'audio/mp4', wav:'audio/wav', wave:'audio/wav', aac:'audio/aac', aif:'audio/aiff', aiff:'audio/aiff', caf:'audio/x-caf', flac:'audio/flac', ogg:'audio/ogg', oga:'audio/ogg', opus:'audio/ogg', webm:'audio/webm'};
export const id = () => crypto.randomUUID();
export const audioType = file => file.type?.startsWith('audio/') ? file.type : AUDIO_TYPES[file.name.split('.').pop().toLowerCase()] || '';
export const formatTime = seconds => {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
export const formatBytes = bytes => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} ГБ` : `${(bytes / 1024 ** 2).toFixed(1)} МБ`;
export function visibleTracks(tracks, filter) {
  return tracks.filter(t => filter === 'review' ? t.priority : filter === 'mastered' ? !t.priority && t.playCount >= 5 : true)
    .sort((a, b) => Number(b.priority) - Number(a.priority) || a.playCount - b.playCount || a.addedAt - b.addedAt);
}
export function nextId(queue, currentId, delta, wrap = false) {
  if (!queue.length) return null;
  const index = queue.findIndex(t => t.id === currentId);
  const next = index + delta;
  return wrap ? queue[(next + queue.length) % queue.length]?.id || null : queue[next]?.id || null;
}
export function resumePosition(position, duration) {
  if (!Number.isFinite(position) || position < 0) return 0;
  return Number.isFinite(duration) && duration > 0 && position >= duration - 0.25 ? 0 : position;
}
export function errorMessage(error) {
  if (error?.name === 'QuotaExceededError') return 'Недостаточно места. Сохраните резервную копию, освободите место и повторите. Уже сохранённые записи не удалены.';
  return error?.message || 'Операция не завершена. Попробуйте ещё раз.';
}
