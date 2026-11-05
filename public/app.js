const status = document.querySelector('#status');
const media = document.querySelector('#media');
const roomSection = document.querySelector('#room');
const key = document.querySelector('#key');
let activeRoom;
let statusTimer;
function message(text) {
  status.textContent = text;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { status.textContent = ''; }, 6500);
}
async function api(path, data) {
  const result = await fetch('/api/'+path,data ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)} : {});
  const body = await result.json();
  if (!result.ok) throw new Error(body.error);
  return body;
}
function action(label, callback) {
  const button = document.createElement('button');
  button.textContent = label;
  button.onclick = async () => {
    button.disabled = true;
    try { await callback(); } catch (error) { message(error.message); }
    finally { button.disabled = false; }
  };
  return button;
}
async function join(id, credentials) {
  const access = await api('join',{id,...credentials});
  const {Room, RoomEvent} = await import('https://cdn.jsdelivr.net/npm/livekit-client@2.22.3/+esm');
  if (activeRoom) await activeRoom.disconnect();
  media.replaceChildren();
  const room = new Room();
  activeRoom = room;
  room.on(RoomEvent.TrackSubscribed,track => media.append(track.attach()));
  room.on(RoomEvent.TrackUnsubscribed,track => track.detach().forEach(element => element.remove()));
  room.on(RoomEvent.LocalTrackPublished,publication => {
    if (publication.track?.kind === 'video') {
      const element = publication.track.attach();
      element.muted = true;
      media.append(element);
    }
  });
  room.on(RoomEvent.Disconnected,() => {
    if (activeRoom === room) {
      media.replaceChildren();
      roomSection.hidden = true;
      activeRoom = undefined;
    }
  });
  try {
    await room.connect(access.url,access.token);
    await room.startAudio();
    await room.localParticipant.enableCameraAndMicrophone();
    roomSection.hidden = false;
    roomSection.scrollIntoView();
  } catch (error) {
    await room.disconnect();
    throw error;
  }
}
const filters = [...document.querySelectorAll('[data-filter]')];
const search = document.querySelector('#course-search');
const category = document.querySelector('#category');
category.addEventListener('change', applyFilter);
const courseCount = document.querySelector('#course-count');
const normalize = text => text.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
search.addEventListener('input', applyFilter);
function applyFilter() {
  const selected = filters.find(button => button.getAttribute('aria-pressed') === 'true').dataset.filter;
  const query = normalize(search.value.trim());
  const cards = [...document.querySelectorAll('#classes [data-kind]')];
  let count = 0;
  for (const card of cards) {
    const matchesFormat = selected === 'all' || card.dataset.kind === selected;
    card.hidden = !matchesFormat || (category.value !== 'all' && card.dataset.category !== category.value) || !normalize(card.textContent).includes(query);
    if (!card.hidden) count++;
  }
  courseCount.textContent = count === 1 ? '1 resultado' :
    count ? count + ' resultados' :
    cards.length ? 'Sin resultados. Prueba otro término o formato.' : '';
}
filters.forEach(button => button.addEventListener('click', () => {
  filters.forEach(option => option.setAttribute('aria-pressed', String(option === button)));
  applyFilter();
}));
async function refresh() {
  const list = document.querySelector('#classes');
  const sessions = await api('classes');
  list.replaceChildren();
  if (!sessions.length) list.textContent = 'Todavía no hay sesiones publicadas.';
  for (const session of sessions) {
    const card = document.createElement('article');
    card.dataset.kind = session.kind;
    card.dataset.category = session.category;
    const title = document.createElement('h3');
    const details = document.createElement('p');
    title.textContent = session.title;
    details.textContent = (session.kind === 'individual' ? 'Clase individual' : 'Taller grupal')+
      ' · '+new Date(session.date).toLocaleString('es-CL')+' · '+session.available+' cupos';
    card.append(title,details);
    const storageKey = 'study-booking-'+session.id;
    const booking = localStorage.getItem(storageKey);
    if (booking) card.append(action('Entrar como alumno',() => join(session.id,{booking})));
    else if (session.available && Date.parse(session.date)>Date.now()) {
      card.append(action('Reservar',async () => {
        const result = await api('book',{id:session.id});
        localStorage.setItem(storageKey,result.booking);
        await refresh();
        message('Reserva guardada en este navegador.');
      }));
    }
    card.append(action('Entrar como instructor',() => join(session.id,{key:key.value})));
    list.append(card);
  }
  applyFilter();
}
document.querySelector('#leave').onclick = () => activeRoom?.disconnect();
document.querySelector('#publish').onsubmit = async event => {
  event.preventDefault();
  const input = Object.fromEntries(new FormData(event.currentTarget));
  try {
    await api('classes',{...input,date:new Date(input.date).toISOString(),key:key.value});
    await refresh();
    message('Sesión publicada.');
  } catch (error) { message(error.message); }
};
if (location.protocol === "file:") {
  applyFilter();
  document.querySelector("#publish").hidden = true;
  document.querySelector("#instructor p").textContent = "Vista previa local. Publicar sesiones y reservar requiere iniciar la aplicación.";
} else {
  refresh().catch(error => message(error.message));
}
