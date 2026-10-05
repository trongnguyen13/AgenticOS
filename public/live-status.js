export async function fetchLiveStatus(api) {
  const [sessions,channels]=await Promise.allSettled([api('/api/sessions'),api('/api/channels')]);
  return {sessions,channels};
}
