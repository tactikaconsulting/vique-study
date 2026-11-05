const status = document.querySelector('#status');
const media = document.querySelector('#media');
const roomSection = document.querySelector('#room');
const key = document.querySelector('#key');
const enableMedia = document.querySelector('#enable-media');
const cameraToggle = document.querySelector('#camera-toggle');
const micToggle = document.querySelector('#mic-toggle');
const callMessages = document.querySelector('#call-messages');
const chatForm = document.querySelector('#call-chat-form');
const chatInput = document.querySelector('#call-message');
const callState = document.querySelector('#call-state');
const callWaiting = document.querySelector('#call-waiting');
const chatTopic = 'vique-study-chat';

function addChatMessage(name, body) {
  const item = document.createElement('li');
  const author = document.createElement('strong');
  const content = document.createElement('span');
  author.textContent = name;
  content.textContent = body;
  item.append(author, content);
  callMessages.append(item);
  if (callMessages.children.length > 200) callMessages.firstElementChild.remove();
  callMessages.scrollTop = callMessages.scrollHeight;
}

chatForm.onsubmit = async event => {
  event.preventDefault();
  const room = activeRoom;
  const body = chatInput.value.trim();
  const button = chatForm.querySelector('button');
  if (!room || !body || button.disabled) return;
  button.disabled = true;
  try {
    await room.localParticipant.publishData(new TextEncoder().encode(body), {reliable:true, topic:chatTopic});
    if (activeRoom !== room) return;
    addChatMessage('Tú', body);
    if (chatInput.value.trim() === body) chatInput.value = '';
    chatInput.focus();
  } catch {
    if (activeRoom === room) message('No se pudo enviar el mensaje. Intenta nuevamente.');
  } finally {
    button.disabled = false;
  }
};
const cameraDevice = document.querySelector('#camera-device');
let cameraFacing = 'user';
async function loadCameras() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const selected = activeRoom?.localParticipant.getTrackPublication('camera')?.track?.mediaStreamTrack.getSettings().deviceId;
  cameraDevice.replaceChildren();
  devices.filter(device => device.kind === 'videoinput').forEach((device, index) => {
    const option = new Option(device.label || 'Cámara '+(index+1), device.deviceId);
    option.selected = device.deviceId === selected;
    cameraDevice.add(option);
  });
}
cameraDevice.onchange = async () => {
  const room = activeRoom;
  if (!room || !cameraDevice.value) return;
  cameraDevice.disabled = true;
  try {
    await room.switchActiveDevice('videoinput', cameraDevice.value);
  } catch {
    message('No se pudo cambiar a esa cámara.');
    await loadCameras().catch(() => {});
  } finally {
    cameraDevice.disabled = false;
  }
};
document.querySelector('#switch-camera').onclick = async event => {
  const room = activeRoom;
  const track = room?.localParticipant.getTrackPublication('camera')?.track;
  if (!track) { message('Activa la cámara antes de cambiarla.'); return; }
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const facing = track.mediaStreamTrack.getSettings().facingMode || cameraFacing;
    const next = facing === 'environment' ? 'user' : 'environment';
    await track.restartTrack({facingMode:{exact:next}});
    cameraFacing = next;
    media.querySelector('.call-local')?.classList.toggle('rear-camera',next === 'environment');
    await loadCameras();
  } catch {
    message('Esa cámara no está disponible. Puedes elegir otra en el menú Cámara.');
  } finally {
    button.disabled = false;
  }
};
document.querySelector('#chat-toggle').onclick = event => {
  const button = event.currentTarget;
  const hidden = roomSection.classList.toggle('chat-hidden');
  button.textContent = hidden ? 'Mostrar chat' : 'Ocultar chat';
  button.setAttribute('aria-expanded',String(!hidden));
};
const detailId = location.pathname.match(/^\/servicios\/([a-f0-9-]{36})$/)?.[1];
const detailPanel = document.querySelector('#service-detail');
const profileForm = document.querySelector('#profile-form');
let profile;
let payment;
const paymentConnect = document.querySelector('#payment-connect');
paymentConnect.onclick = async () => {
  paymentConnect.disabled = true;
  try {
    const result = await api('mercadopago/connect',{});
    location.assign(result.url);
  } catch (error) {
    message(error.message);
    paymentConnect.disabled = false;
  }
};
const clp = new Intl.NumberFormat('es-CL',{style:'currency',currency:'CLP'});
const publishForm = document.querySelector('#publish');
const priceInput = publishForm.elements.price;
const pricePreview = document.querySelector('#price-preview');
function previewPrice() {
  const price = Number(priceInput.value);
  const commission = Math.round(price * 0.15);
  pricePreview.textContent = !priceInput.validity.valid ? 'Ingresa un precio válido en pesos.' : price > 0 ?
    'Comisión estimada (15%): '+clp.format(commission)+' · Recibirías '+clp.format(price-commission)+' antes de la tarifa de Mercado Pago.' :
    'Gratis · sin comisión.';
}
priceInput.addEventListener('input',previewPrice);
async function reserveSession(session) {
  const result = await api('book',{id:session.id});
  if (result.checkoutUrl) {
    location.assign(result.checkoutUrl);
    return;
  }
  await refresh();
  message('Reserva guardada en tu cuenta.');
}
function priceLabel(session) {
  return session.price_clp > 0 ? clp.format(session.price_clp)+' CLP por persona' : 'Gratis';
}
const tutorView = location.pathname === '/tutores';
const catalog = document.querySelector('#catalogo');
const tutorPanel = document.querySelector('#instructor');
const hero = document.querySelector('.hero');
const guide = document.querySelector('#como-funciona');
const dashboard = document.querySelector('#dashboard');
const dashboardTitle = document.querySelector('#dashboard-title');
const dashboardCopy = document.querySelector('#dashboard-copy');
const dashboardPrimary = document.querySelector('#dashboard-primary');
const myBookings = document.querySelector('#my-bookings');
const accountPanel = document.querySelector('#account');
const accountForm = document.querySelector('#account-form');
const logout = document.querySelector('#account-logout');
const role = tutorView ? 'tutor' : 'student';
const accountPage = tutorView || location.pathname === '/estudiantes';
let user;
let registering = false;
function drawAccount() {
  const sameRole = user?.role === role;
  paymentConnect.disabled = !sameRole || !payment?.available || payment.connected;
  document.querySelector('#payment-status').textContent = payment?.connected ?
    'Cuenta de prueba conectada.' : payment?.available ? 'Vincula una cuenta vendedora de prueba para preparar el reparto.' :
    'La vinculación de prueba está pendiente de configuración.';
  accountForm.hidden = Boolean(user);
  profileForm.hidden = !sameRole;
  document.querySelector('#professional-fields').hidden = !tutorView;
  profileForm.elements.name.value = user?.name ?? '';
  for (const field of ['specialty','bio','training','experience']) profileForm.elements[field].value = profile?.[field] ?? '';
  logout.hidden = !user;
  document.querySelector('#account-title').textContent = tutorView ? 'Acceso de tutores' : 'Acceso de estudiantes';
  document.querySelector('#account-status').textContent = sameRole ? 'Hola, '+user.name :
    user ? 'Tienes una sesión de otro tipo. Cierra sesión para entrar aquí.' : '';
  document.querySelector('#account-name').hidden = !registering;
  accountForm.elements.name.required = registering;
  document.querySelector('#account-invite').hidden = !registering || !tutorView;
  accountForm.elements.invite.required = registering && tutorView;
  accountForm.elements.password.autocomplete = registering ? 'new-password' : 'current-password';
  document.querySelector('#account-submit').textContent = registering ? 'Crear cuenta' : 'Iniciar sesión';
  document.querySelector('#account-toggle').textContent = registering ? 'Ya tengo cuenta' : 'Crear cuenta';
  const signedIn = Boolean(sameRole);
  dashboardTitle.textContent = signedIn ? 'Hola, '+user.name : tutorView ? 'Espacio de tutores' : 'Espacio de estudiantes';
  dashboardCopy.textContent = tutorView ? 'Publica clases individuales y talleres. Desde aquí puedes entrar a tus sesiones.' :
    'Encuentra tu próxima clase y accede a tus reservas desde cualquier dispositivo.';
  dashboardPrimary.href = tutorView && signedIn ? '#instructor' : signedIn ? '#catalogo' : '#account';
  dashboardPrimary.textContent = tutorView && signedIn ? 'Publicar una clase' : signedIn ? 'Explorar cursos' : 'Acceder a mi cuenta';
  myBookings.hidden = user?.role !== 'student' || !accountPage;
  if (myBookings.hidden) myBookings.setAttribute('aria-pressed','false');
  showWorkspace();
}
document.querySelector('#account-toggle').onclick = () => {
  registering = !registering;
  drawAccount();
};
accountForm.onsubmit = async event => {
  event.preventDefault();
  const submit = document.querySelector('#account-submit');
  submit.disabled = true;
  try {
    const data = Object.fromEntries(new FormData(accountForm));
    ({user} = await api(registering ? 'register' : 'login',{...data,role}));
    accountForm.reset();
    registering = false;
    drawAccount();
    ({profile,payment} = await api('account'));
    drawAccount();
    await refresh();
  } catch (error) { message(error.message); }
  finally { submit.disabled = false; }
};
profileForm.onsubmit = async event => {
  event.preventDefault();
  try {
    ({user,profile} = await api('profile',Object.fromEntries(new FormData(profileForm))));
    drawAccount();
    await refresh();
    message('Perfil guardado.');
  } catch (error) { message(error.message); }
};
logout.onclick = async () => {
  try {
    await api('logout',{});
    user = undefined;
    profile = undefined;
    payment = undefined;
    drawAccount();
    await refresh();
  } catch (error) { message(error.message); }
};
function showWorkspace(inRoom = false) {
  detailPanel.hidden = inRoom || !detailId;
  hero.hidden = inRoom || Boolean(detailId) || tutorView || location.pathname === '/estudiantes';
  guide.hidden = inRoom || accountPage || Boolean(detailId);
  dashboard.hidden = inRoom || !accountPage;
  catalog.hidden = inRoom || Boolean(detailId) || (tutorView && user?.role !== 'tutor');
  accountPanel.hidden = inRoom || !accountPage;
  tutorPanel.hidden = inRoom || !tutorView || user?.role !== 'tutor';
}
showWorkspace();
if (tutorView) {
  catalog.querySelector('h2').textContent = 'Mis clases y talleres';
  document.querySelector('#pilot-note').textContent = 'Aquí puedes entrar a tus sesiones publicadas.';
  catalog.before(tutorPanel);
}
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
  chatForm.reset();
  callMessages.replaceChildren();
  callWaiting.hidden = false;
  cameraToggle.hidden = true;
  micToggle.hidden = true;
  enableMedia.hidden = false;
  callState.textContent = 'En la sala';
  cameraFacing = 'user';
  const room = new Room();
  activeRoom = room;
  function attachTrack(track, name, local = false) {
    const element = track.attach();
    if (track.kind !== 'video') {
      media.append(element);
      return;
    }
    element.playsInline = true;
    element.muted = local;
    const tile = document.createElement('figure');
    tile.className = local ? 'call-tile call-local' : 'call-tile';
    const label = document.createElement('figcaption');
    label.textContent = name;
    tile.append(element, label);
    media.append(tile);
    media.classList.toggle('has-remote',Boolean(media.querySelector('.call-tile:not(.call-local)')));
    callWaiting.hidden = true;
  }
  function detachTrack(track) {
    track?.detach().forEach(element => (element.closest('.call-tile') || element).remove());
    callWaiting.hidden = Boolean(media.querySelector('video'));
    media.classList.toggle('has-remote',Boolean(media.querySelector('.call-tile:not(.call-local)')));
  }
  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => attachTrack(track, participant.name || 'Participante'));
  room.on(RoomEvent.TrackUnsubscribed, detachTrack);
  room.on(RoomEvent.LocalTrackPublished, publication => {
    if (publication.track?.kind === 'video') attachTrack(publication.track, 'Tú', true);
  });
  room.on(RoomEvent.LocalTrackUnpublished, publication => detachTrack(publication.track));
  room.on(RoomEvent.DataReceived, (payload, participant, kind, topic) => {
    if (activeRoom !== room || !participant || topic !== chatTopic || payload.byteLength > 2000) return;
    const body = new TextDecoder().decode(payload).trim();
    if (body && body.length <= 500) addChatMessage(participant.name || 'Participante', body);
  });
  room.on(RoomEvent.Reconnecting, () => { callState.textContent = 'Reconectando…'; });
  room.on(RoomEvent.Reconnected, () => { callState.textContent = 'En la sala'; });
  room.on(RoomEvent.Disconnected,() => {
    if (activeRoom === room) {
      media.replaceChildren();
      roomSection.hidden = true;
      activeRoom = undefined;
      showWorkspace();
    }
  });
  try {
    await room.connect(access.url,access.token);
    enableMedia.disabled = false;
    roomSection.hidden = false;
    showWorkspace(true);
    roomSection.querySelector('h2').focus();
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
myBookings.onclick = () => {
  myBookings.setAttribute('aria-pressed',String(myBookings.getAttribute('aria-pressed') !== 'true'));
  applyFilter();
};
function applyFilter() {
  const selected = filters.find(button => button.getAttribute('aria-pressed') === 'true').dataset.filter;
  const query = normalize(search.value.trim());
  const cards = [...document.querySelectorAll('#classes [data-kind]')];
  let count = 0;
  for (const card of cards) {
    const matchesFormat = selected === 'all' || card.dataset.kind === selected;
    const matchesBooking = myBookings.getAttribute('aria-pressed') !== 'true' || card.dataset.reserved === 'true';
    card.hidden = !matchesBooking || !matchesFormat || (category.value !== 'all' && card.dataset.category !== category.value) || !normalize(card.textContent).includes(query);
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
  if (detailId) return renderDetail(sessions.find(session => session.id === detailId));
  list.replaceChildren();

  for (const session of sessions) {
    if (tutorView && !session.mine && session.tutor_id) continue;
    const card = document.createElement('article');
    card.dataset.kind = session.kind;
    card.dataset.category = session.category;
    const badge = document.createElement('small');
    badge.className = 'session-badge';
    badge.textContent = session.category+' · '+(session.kind === 'individual' ? 'Individual' : 'Taller');
    const title = document.createElement('h3');
    const details = document.createElement('p');
    title.textContent = session.title;
    details.textContent = (session.kind === 'individual' ? 'Clase individual' : 'Taller grupal')+
      ' · '+new Date(session.date).toLocaleString('es-CL')+' · '+session.available+' cupos';
    const price = document.createElement('p');
    price.className = 'session-price';
    price.textContent = priceLabel(session)+(session.duration_minutes ? ' · '+session.duration_minutes+' min' : '');
    card.append(badge,title,details,price);
    if (!tutorView) {
      const link = document.createElement('a');
      link.className = 'service-link';
      link.href = '/servicios/'+session.id;
      link.textContent = 'Ver ficha del servicio →';
      card.append(link);
    }
    const storageKey = 'study-booking-'+session.id;
    const booking = localStorage.getItem(storageKey);
    card.dataset.reserved = String(Boolean(session.reserved || booking));
    if (tutorView) {
      if (user?.role === 'tutor') card.append(action('Entrar como tutor',() => join(session.id,{key:key.value})));
    } else if (session.reserved) card.append(action('Entrar a mi clase',() => join(session.id,{})));
    else if (booking) card.append(action('Entrar a mi clase',() => join(session.id,{booking})));
    else if (session.price_clp > 0 && !session.checkout_ready) {
      const pending = document.createElement('p');
      pending.textContent = 'Pago de prueba aún no disponible';
      card.append(pending);
    } else if ((session.available || session.checkout_pending) && Date.parse(session.date)>Date.now()) {
      card.append(action(session.price_clp > 0 ? 'Reservar y pagar (prueba)' : 'Reservar',async () => {
        if (user?.role !== 'student') {
          if (!accountPage) { location.href = '/estudiantes'; return; }
          accountPanel.scrollIntoView();
          message('Crea una cuenta de estudiante o inicia sesión para reservar.');
          return;
        }
        await reserveSession(session);
      }));
    }
    list.append(card);
  }
  if (!list.children.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = tutorView ? 'Aquí aparecerán las clases que publiques.' : 'Todavía no hay clases publicadas. Vuelve pronto para ver nuevas sesiones.';
    list.append(empty);
  }
  applyFilter();
}
function renderDetail(session) {
  detailPanel.replaceChildren();
  const back = document.createElement('a');
  back.href = '/estudiantes';
  back.textContent = '← Volver al catálogo';
  detailPanel.append(back);
  const heading = document.createElement('h1');
  heading.textContent = session?.title ?? 'Servicio no disponible';
  detailPanel.append(heading);
  if (!session) return;
  const info = document.createElement('article');
  function field(label,value) {
    if (!value) return;
    const title = document.createElement('h2');
    title.textContent = label;
    const text = document.createElement('p');
    text.textContent = value;
    info.append(title,text);
  }
  field('Sobre la sesión',session.description || (session.kind === 'individual' ? 'Sesión individual por videollamada.' : 'Sesión grupal por videollamada.'));
  field('Precio y duración',priceLabel(session)+(session.duration_minutes ? ' · '+session.duration_minutes+' min' : ''));
  field('Horario y cupos',new Date(session.date).toLocaleString('es-CL')+' · '+session.available+' disponibles');
  field('Profesional',session.tutor_name ? [session.tutor_name,session.specialty].filter(Boolean).join(' · ') : 'Perfil aún no publicado');
  field('Presentación',session.bio);
  field('Formación y credenciales declaradas',session.training);
  field('Experiencia declarada',session.experience);
  const booking = localStorage.getItem('study-booking-'+session.id);
  if (session.reserved || booking) info.append(action('Entrar a mi sesión',() => join(session.id,booking ? {booking} : {})));
  else if (session.price_clp > 0 && !session.checkout_ready) field('Reserva','Pago de prueba aún no disponible.');
  else if ((session.available || session.checkout_pending) && Date.parse(session.date)>Date.now()) {
    if (user?.role === 'student') info.append(action(session.price_clp > 0 ? 'Reservar y pagar (prueba)' : 'Reservar cupo',() => reserveSession(session)));
    else {
      const link = document.createElement('a');
      link.href = '/estudiantes#account';
      link.className = 'button';
      link.textContent = 'Ingresar como estudiante';
      info.append(link);
    }
  }
  detailPanel.append(info);
}
enableMedia.onclick = async () => {
  const room = activeRoom;
  if (!room) return;
  enableMedia.disabled = true;
  try {
    await Promise.all([room.startAudio(), room.localParticipant.enableCameraAndMicrophone()]);
    if (activeRoom !== room) return;
    enableMedia.hidden = true;
    cameraToggle.hidden = false;
    micToggle.hidden = false;
    await loadCameras().catch(() => {});
    cameraToggle.textContent = 'Apagar cámara';
    micToggle.textContent = 'Silenciar micrófono';
  } catch (error) {
    enableMedia.disabled = false;
    message(error.name === 'NotAllowedError' ?
      'El navegador bloqueó la cámara o el micrófono. Revisa los permisos del sitio y vuelve a tocar Activar.' :
      error.message);
  }
};
function bindMediaToggle(button, field, method, onLabel, offLabel) {
  button.onclick = async () => {
    const room = activeRoom;
    if (!room) return;
    const participant = room.localParticipant;
    button.disabled = true;
    try {
      await participant[method](!participant[field]);
      if (activeRoom === room) button.textContent = participant[field] ? onLabel : offLabel;
    } catch {
      message('Revisa los permisos de cámara y micrófono.');
    } finally {
      button.disabled = false;
    }
  };
}
bindMediaToggle(cameraToggle,'isCameraEnabled','setCameraEnabled','Apagar cámara','Encender cámara');
bindMediaToggle(micToggle,'isMicrophoneEnabled','setMicrophoneEnabled','Silenciar micrófono','Activar micrófono');
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
  api('account').then(result => { user = result.user; profile = result.profile; payment = result.payment; drawAccount(); return refresh(); }).catch(error => message(error.message));
}

const paymentResult = new URLSearchParams(location.search).get('mercadopago');
if (tutorView && paymentResult) {
  message(paymentResult === 'connected' ? 'Cuenta de prueba conectada.' : 'No se pudo conectar la cuenta de prueba. Verifica que hayas iniciado sesión como tutor y vuelve a intentarlo.');
  history.replaceState(null,'',location.pathname);
}

const purchaseResult = new URLSearchParams(location.search).get('compra');
if (purchaseResult) {
  const purchaseMessages = {
    confirmed:'Pago de prueba aprobado. Tu reserva está confirmada.',
    pending:'El pago de prueba aún no está confirmado.',
    unavailable:'El pago de prueba fue aprobado, pero el cupo ya no está disponible.'
  };
  message(purchaseMessages[purchaseResult] || purchaseMessages.pending);
  history.replaceState(null,'',location.pathname);
}
