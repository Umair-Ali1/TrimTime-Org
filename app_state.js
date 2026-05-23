// ════ EMAILJS CONFIG ════
const _EJS_PUBLIC_KEY          = 'yILXV4sntRvEkh58q';
const _EJS_SERVICE_ID          = 'service_xgkkf6m';
const _EJS_TEMPLATE_ID         = 'template_gm1s8y7';   // login / signup
const _EJS_BOOKING_TEMPLATE_ID = 'template_1n6tf5c'; // booking confirmation
function _sendBookingEmail(toEmail, toName, bookingRef, salonName, service, barber, date, time, paymentMethod, price) {
  if (typeof emailjs === 'undefined' || _EJS_BOOKING_TEMPLATE_ID === 'YOUR_BOOKING_TEMPLATE_ID') return;
  emailjs.send(_EJS_SERVICE_ID, _EJS_BOOKING_TEMPLATE_ID, {
    to_email: toEmail, to_name: toName,
    booking_ref: bookingRef, salon_name: salonName,
    service, barber: barber || 'Any Available',
    date, time, payment_method: paymentMethod || 'Cash',
    price
  }, { publicKey: _EJS_PUBLIC_KEY }).catch(err => console.warn('EmailJS booking error:', err));
}
function _sendEmail(toEmail, toName, actionTitle, actionMessage, actionNote, ctaText) {
  if (typeof emailjs === 'undefined') return;
  emailjs.send(_EJS_SERVICE_ID, _EJS_TEMPLATE_ID, {
    to_email: toEmail, to_name: toName,
    action_title: actionTitle, action_message: actionMessage,
    action_note: actionNote, cta_text: ctaText
  }, { publicKey: _EJS_PUBLIC_KEY }).catch(err => console.warn('EmailJS error:', err));
}

// ════ SUPABASE CLIENT ════
const _supabase = supabase.createClient(
  'https://cyekdfftxzqanmgmmsza.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN5ZWtkZmZ0eHpxYW5tZ21tc3phIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0NjQyMDAsImV4cCI6MjA5NTA0MDIwMH0.MWE6eNaEBB2yKcRLSNWDMTRX4EbsVWdQW5MuYC6TGRM'
);

// ════ LOCAL UI STATE ════
const STORE = {
  get: k => { try { return JSON.parse(localStorage.getItem('tt2_'+k)) } catch { return null } },
  set: (k,v) => localStorage.setItem('tt2_'+k, JSON.stringify(v)),
  del: k => localStorage.removeItem('tt2_'+k)
};

// ════ STATE ════
let currentUser = null;
let currentSaloon = null;        // active saloon for owner/employee
let _approvalChannel  = null;    // Supabase Realtime channel for approval watching
let _approvalPollInterval = null; // polling fallback
let currentBookingSaloon = null; // saloon selected for the booking flow
let currentStep = 1;
let booking = { service:null, subService:null, seat:null, slot:null, barber:null, payment:'cash', date:'' };
let activeChipFilter = 'all';
let modalRating = 0;
let empRatingVal = 5;
let shopIsOpen = true;
let empIsAvail = true;
let _cachedOwnerBookings = [];
let _reviewedBookingIds  = new Set();
let _reviewModalBookingId = null;

// ════ PAGES ════
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0,0);
  if (id === 'pgHome') renderSaloons();
  if (id === 'pgBooking') initBooking();
  if (id === 'pgUserDash') refreshUserDash();
  if (id === 'pgOwnerDash') refreshOwnerDash();
  if (id === 'pgEmpDash') refreshEmpDash();
  if (id === 'pgAdmin') refreshAdminDash();
}

// ════ AUTH ════
function switchLoginTab(tab, el) {
  document.querySelectorAll('.ftab').forEach(b => b.classList.remove('on'));
  el.classList.add('on');
  document.getElementById('loginSection').style.display = tab==='login' ? 'block' : 'none';
  document.getElementById('registerSection').style.display = tab==='register' ? 'block' : 'none';
}
function selectRegRole(el, role) {
  document.querySelectorAll('.role-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected'); el.dataset.role = role;
  document.getElementById('inviteNote').classList.toggle('show', role==='employee');
  document.getElementById('inviteCodeField').style.display = role==='employee' ? 'block' : 'none';
  document.getElementById('saloonNameField').style.display = role==='owner' ? 'block' : 'none';
}
async function doLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const pass  = document.getElementById('loginPass').value;
  const errEl = document.getElementById('loginError');
  const btn   = document.getElementById('loginBtn');
  const resetBtn = () => { btn.classList.remove('btn-loading'); btn.innerHTML = 'Login'; };
  const showErr  = msg => { resetBtn(); errEl.textContent = msg; errEl.classList.add('show'); };
  errEl.classList.remove('show');
  if (!email || !pass) return showErr('Please enter your email and password.');
  btn.classList.add('btn-loading');
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>&nbsp; Logging in...';
  try {
    const { data, error } = await _supabase.auth.signInWithPassword({ email, password: pass });
    if (error) return showErr(error.message);
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>&nbsp; Loading your account...';
    if (email === 'admin@trimtime.com') {
      const { data: existing } = await _supabase.from('profiles').select('id').eq('id', data.user.id).single();
      if (!existing) await _supabase.from('profiles').upsert({ id: data.user.id, role: 'admin', first_name: 'Admin', last_name: 'TrimTime' });
    }
    await loadUserAndRoute(data.user);
    _sendEmail(email, currentUser?.firstName || 'there',
      'New Sign-In to Your Account 🔐',
      'We noticed a new sign-in to your TrimTime account. If this was you, no action is needed.',
      'If you did not sign in, please contact us immediately at info@trimtime.com.',
      'Go to TrimTime'
    );
    _clearAuthForms();
    resetBtn();
  } catch (e) {
    showErr('Unexpected error: ' + e.message);
  }
}
async function doRegister() {
  const first = document.getElementById('regFirst').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const phone = document.getElementById('regPhone').value.trim();
  const pass  = document.getElementById('regPass').value;
  const pass2 = document.getElementById('regPass2').value;
  const role  = document.querySelector('.role-card.selected')?.dataset.role || 'customer';
  const errEl = document.getElementById('regError');
  const sucEl = document.getElementById('regSuccess');
  const btn   = document.getElementById('regBtn');
  const resetBtn = () => { btn.classList.remove('btn-loading'); btn.innerHTML = 'Create Account'; };
  const showErr  = msg => { resetBtn(); errEl.textContent = msg; errEl.classList.add('show'); };
  errEl.classList.remove('show'); sucEl.classList.remove('show');
  if (!first || !email || !pass) return showErr('Please fill in all required fields.');
  if (pass.length < 6)           return showErr('Password must be at least 6 characters.');
  if (pass !== pass2)            return showErr('Passwords do not match.');
  btn.classList.add('btn-loading');
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>&nbsp; Creating your account...';
  try {
    const { data, error } = await _supabase.auth.signUp({ email, password: pass });
    if (error) return showErr(error.message);
    if (!data.user) return showErr('This email may already be registered. Try logging in instead.');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>&nbsp; Setting up profile...';
    const nameParts = first.trim().split(' ');
    const { error: profErr } = await _supabase.from('profiles').upsert({
      id: data.user.id, role,
      first_name: nameParts[0],
      last_name:  nameParts.slice(1).join(' '),
      phone, city: ''
    });
    if (profErr) return showErr('Database error: ' + profErr.message + '. Make sure the schema SQL has been run in Supabase.');
    if (role === 'owner') {
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>&nbsp; Creating your salon...';
      const salonName = document.getElementById('regSalon')?.value.trim() || nameParts[0] + "'s Salon";
      await _setupNewOwnerSalon(data.user.id, salonName);
    }
    if (role === 'employee') {
      const inviteCode = document.getElementById('regInvite')?.value.trim().toUpperCase();
      if (!inviteCode) return showErr('Please enter the invite code you received from your salon owner.');
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>&nbsp; Joining salon...';
      const { data: salon, error: salonErr } = await _supabase.from('saloons').select('id').eq('invite_code', inviteCode).single();
      if (salonErr || !salon) return showErr('Invalid invite code. Ask your salon owner for the correct code.');
      const fullName = first.trim();
      const initials = nameParts.map(p => p[0]).slice(0, 2).join('').toUpperCase();
      const { error: empErr } = await _supabase.from('employees').insert({
        user_id:   data.user.id,
        saloon_id: salon.id,
        name:      fullName,
        role:      'Barber',
        status:    'available',
        avatar:    initials
      });
      if (empErr) return showErr('Failed to join salon: ' + empErr.message);
    }
    if (data.session) {
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>&nbsp; Taking you in...';
      await loadUserAndRoute(data.user);
      _sendEmail(email, first,
        'Welcome to TrimTime! 🎉',
        'Your account has been successfully created. You\'re now ready to discover the best salons near you and book appointments in just a few clicks.',
        'Browse salons, choose your barber, and enjoy your perfect look — anytime, anywhere.',
        'Open TrimTime'
      );
      _clearAuthForms();
      resetBtn();
    } else {
      resetBtn();
      sucEl.textContent = 'Account created! Check your email to confirm, then log in.';
      sucEl.classList.add('show');
      setTimeout(() => { document.querySelectorAll('.ftab')[0].click(); document.getElementById('loginEmail').value = email; }, 2000);
    }
  } catch (e) {
    showErr('Unexpected error: ' + e.message);
  }
}
async function _setupNewOwnerSalon(ownerId, salonName) {
  const code='TT-'+Math.random().toString(36).substr(2,4).toUpperCase()+'-'+Math.floor(1000+Math.random()*9000);
  const { data: salon } = await _supabase.from('saloons').insert({ owner_id:ownerId, name:salonName, area:'Lahore', city:'Lahore', rating:4.5, reviews:0, price_from:300, icon:'✂️', image_url:'', is_open:true, tags:['hair','beard'], invite_code:code, approval_status:'draft' }).select().single();
  if (!salon) return;
  await _supabase.from('services').insert([
    { saloon_id:salon.id, icon:'✂️', name:'Hair Cutting', price:300, duration:'30–45 min', active:true },
    { saloon_id:salon.id, icon:'🪒', name:'Beard & Shave', price:200, duration:'20–30 min', active:true },
    { saloon_id:salon.id, icon:'💆', name:'Facial & Skin', price:500, duration:'45–60 min', active:true },
    { saloon_id:salon.id, icon:'🧴', name:'Head Massage', price:400, duration:'30 min', active:true },
  ]);
  await _supabase.from('seats').insert([1,2,3,4,5,6].map(n=>({ saloon_id:salon.id, seat_number:n, status:'available' })));
}
async function loadUserAndRoute(authUser) {
  const { data: profile } = await _supabase.from('profiles').select('*').eq('id', authUser.id).single();
  if (!profile) { toast('Profile not found — please sign up','error'); showPage('pgLogin'); return; }
  if (profile.is_suspended) { await _supabase.auth.signOut(); toast('Your account has been suspended. Please contact support.','error'); showPage('pgLogin'); return; }
  currentUser = { id:authUser.id, email:authUser.email, role:profile.role, firstName:profile.first_name||'', lastName:profile.last_name||'', phone:profile.phone||'', city:profile.city||'' };
  if (profile.role === 'owner') {
    const { data: salon } = await _supabase.from('saloons').select('*').eq('owner_id', authUser.id).single();
    currentSaloon = salon;
  } else if (profile.role === 'employee') {
    const { data: emp } = await _supabase.from('employees').select('*, saloons(*)').eq('user_id', authUser.id).single();
    currentSaloon = emp?.saloons || null;
  }
  if (profile.role === 'admin') showPage('pgAdmin');
  else if (profile.role === 'owner') showPage('pgOwnerDash');
  else if (profile.role === 'employee') showPage('pgEmpDash');
  else showPage('pgHome');
}
function openDeleteAccountModal() {
  const role = currentUser?.role;
  const msgEl = document.getElementById('deleteAccountMsg');
  const inputEl = document.getElementById('deleteConfirmInput');
  const btnEl = document.getElementById('deleteAccountConfirmBtn');
  if (msgEl) {
    if (role === 'owner') {
      msgEl.textContent = 'This will permanently delete your salon, all its services, seats, bookings, and all employee accounts linked to your salon. This cannot be undone.';
    } else if (role === 'employee') {
      msgEl.textContent = 'This will permanently delete your employee account and remove you from your salon. This cannot be undone.';
    } else {
      msgEl.textContent = 'This will permanently delete your account and all your booking history. This cannot be undone.';
    }
  }
  if (inputEl) inputEl.value = '';
  if (btnEl) btnEl.disabled = true;
  openModal('deleteAccountModal');
}
async function deleteAccount() {
  closeModal('deleteAccountModal');
  const role = currentUser?.role;
  toast('Deleting account...', 'info');
  try {
    if (role === 'owner' && currentSaloon?.id) {
      const { data: emps } = await _supabase.from('employees').select('user_id').eq('saloon_id', currentSaloon.id);
      for (const emp of (emps || [])) {
        if (emp.user_id) await _supabase.from('profiles').delete().eq('id', emp.user_id);
      }
      await _supabase.from('saloons').delete().eq('id', currentSaloon.id);
    } else if (role === 'employee') {
      await _supabase.from('employees').delete().eq('user_id', currentUser.id);
    }
    await _supabase.from('profiles').delete().eq('id', currentUser.id);
    await _supabase.rpc('delete_current_user');
    _clearApprovalWatcher();
    await _supabase.auth.signOut();
    currentUser = null; currentSaloon = null;
    _clearAuthForms();
    showPage('pgLogin');
    toast('Account deleted successfully.', 'info');
  } catch (e) {
    toast('Delete failed: ' + e.message, 'error');
  }
}
function _clearAuthForms() {
  ['loginEmail','loginPass','regFirst','regEmail','regPhone','regPass','regPass2','regSalon','regInvite'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.querySelectorAll('.role-card').forEach(c => c.classList.remove('selected'));
  document.querySelectorAll('.role-card[data-role="customer"]').forEach(c => c.classList.add('selected'));
  ['loginError','regError','regSuccess'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('show');
  });
}
function doLogout() { openModal('logoutModal'); }
async function _confirmLogout() { closeModal('logoutModal'); _clearApprovalWatcher(); await _supabase.auth.signOut(); currentUser=null; currentSaloon=null; _clearAuthForms(); showPage('pgLogin'); toast('Signed out successfully.','info'); }

// ════ HOME ════
function setChip(f, el) {
  activeChipFilter = f;
  document.querySelectorAll('.chip-bar .chip').forEach(c => c.classList.remove('on'));
  el.classList.add('on');
  renderSaloons();
}
async function refreshHomeStats() {
  const [
    { count: saloonCount },
    { count: userCount },
    { count: seatCount },
    { data: ratingData },
    { count: bookingCount }
  ] = await Promise.all([
    _supabase.from('saloons').select('*', { count: 'exact', head: true }),
    _supabase.from('profiles').select('*', { count: 'exact', head: true }),
    _supabase.from('seats').select('*', { count: 'exact', head: true }).eq('status', 'available'),
    _supabase.from('saloons').select('rating'),
    _supabase.from('bookings').select('*', { count: 'exact', head: true })
  ]);
  const avg = ratingData?.length
    ? (ratingData.reduce((sum, s) => sum + (s.rating || 0), 0) / ratingData.length).toFixed(1)
    : '—';
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('statSalons',   saloonCount  ?? '—');
  set('statUsers',    userCount    ?? '—');
  set('statSeats',    seatCount    ?? '—');
  set('statRating',   avg);
  set('statBookings', bookingCount ?? '—');
}
function browseAsGuest() {
  showPage('pgHome');
  renderSaloons();
}
async function renderSaloons() {
  refreshHomeStats();
  const loggedIn = !!currentUser;
  const av = document.getElementById('homeAv');
  const loginBtn = document.getElementById('homeLoginBtn');
  const notifBtn = document.getElementById('homeNotifBtn');
  if (av)       { av.style.display       = loggedIn ? 'flex' : 'none'; }
  if (loginBtn) { loginBtn.style.display  = loggedIn ? 'none' : 'flex'; }
  if (notifBtn) { notifBtn.style.display  = loggedIn ? 'flex' : 'none'; }
  if (loggedIn && av) av.textContent = (currentUser.firstName[0]+(currentUser.lastName?.[0]||'')).toUpperCase();
  const { data: saloons } = await _supabase.from('saloons').select('*').eq('is_suspended', false).eq('approval_status', 'approved').order('rating', { ascending: false });
  const q = (document.getElementById('searchInput')?.value || '').toLowerCase();
  let list = (saloons || []).filter(s => {
    if (q && !s.name.toLowerCase().includes(q) && !(s.area||'').toLowerCase().includes(q)) return false;
    if (activeChipFilter === 'open' && !s.is_open) return false;
    if (activeChipFilter === 'top' && s.rating < 4.8) return false;
    if (['hair','beard','facial','massage','kids'].includes(activeChipFilter) && !s.tags?.includes(activeChipFilter)) return false;
    return true;
  });
  const container = document.getElementById('saloonCards');
  if (!container) return;
  container.innerHTML = list.map(s => `
    <div class="salon-card" onclick="bookSaloon('${s.id}')">
      <div class="salon-img" style="${s.image_url?'background:none;padding:0':''}">
        ${s.image_url?`<img src="${s.image_url}" style="width:100%;height:100%;object-fit:cover" onerror="this.parentElement.innerHTML='<i class=\\'fas fa-scissors\\' style=\\'font-size:40px;color:var(--p)\\'></i><div class=\\'salon-status${s.is_open?'':' closed'}\\'>${s.is_open?'Open':'Closed'}</div>'">`:`<i class="fas fa-scissors" style="font-size:40px;color:var(--p)"></i>`}
        <div class="salon-status${s.is_open?'':' closed'}">${s.is_open?'Open':'Closed'}</div>
      </div>
      <div class="salon-body">
        <div class="salon-name">${s.name}</div>
        <div class="salon-loc"><i class="fas fa-location-dot" style="color:var(--p);margin-right:4px"></i>${s.area||'Lahore'}, ${s.city||'Lahore'}</div>
        <div class="salon-meta"><span class="salon-rating">★ ${s.rating||4.5}</span><span>(${s.reviews||0} reviews)</span></div>
        <div class="salon-foot"><div class="salon-price">From <strong>Rs. ${s.price_from||300}</strong></div><button class="btn btn-sm" style="pointer-events:none">Book Now</button></div>
      </div>
    </div>`).join('') || '<p style="color:var(--text3);padding:24px">No salons found.</p>';
}
async function bookSaloon(id) {
  if (!currentUser) { toast('Please log in to book a salon.', 'error'); showPage('pgLogin'); return; }
  const { data: salon } = await _supabase.from('saloons').select('*').eq('id', id).single();
  currentBookingSaloon = salon;
  showPage('pgBooking');
}
function filterSaloons() { renderSaloons(); toast('Filters applied','info'); }

// ════ BOOKING ════
const SUB_SERVICES = {
  'Hair Cutting': ['Classic Cut','Fade Cut','Crew Cut','Skin Fade','Taper Cut'],
  'Beard & Shave': ['Full Beard Trim','Clean Shave','Beard Shaping','Line Up'],
  'Facial & Skin': ['Deep Cleansing','Brightening Facial','Anti-Aging'],
  'Head Massage': ['Relaxing Massage','Oil Massage','Hot Towel'],
  'Hair Coloring': ['Full Color','Highlights','Balayage'],
  'Full Grooming': ['Premium Package','Deluxe Package']
};
function initBooking() {
  currentStep = 1;
  booking = { service:null, subService:null, seat:null, slot:null, barber:null, payment:'cash', date:'' };
  document.querySelectorAll('.step-section').forEach(s => s.classList.remove('active'));
  document.getElementById('step1').classList.add('active');
  updateStepUI();
  const d = new Date(); d.setDate(d.getDate()+1);
  const bd = document.getElementById('bookDate');
  if (bd) bd.value = d.toISOString().split('T')[0];
  booking.date = bd?.value || '';
  if (currentBookingSaloon) {
    const nameEl = document.querySelector('.book-salon-name');
    if (nameEl) nameEl.textContent = currentBookingSaloon.name;
  }
  renderServiceGrid(); renderSeatGrid(); renderSlotGrid(); renderBarberGrid();
  updateLiveSummary();
}
async function renderServiceGrid() {
  let services = [];
  if (currentBookingSaloon) {
    const { data } = await _supabase.from('services').select('*').eq('saloon_id', currentBookingSaloon.id).eq('active', true);
    services = data || [];
  }
  if (!services.length) {
    services = [
      { id:'s1', icon:'✂️', name:'Hair Cutting', price:300, duration:'30–45 min' },
      { id:'s2', icon:'🪒', name:'Beard & Shave', price:200, duration:'20–30 min' },
      { id:'s3', icon:'💆', name:'Facial & Skin', price:500, duration:'45–60 min' },
      { id:'s4', icon:'🧴', name:'Head Massage', price:400, duration:'30 min' },
    ];
  }
  document.getElementById('svcGrid').innerHTML = services.map(s => `
    <div class="svc-card" onclick="pickService(this,'${s.name}',${s.price},'${s.icon||'✂️'}')">
      <div class="svc-icon">${s.icon||'✂️'}</div>
      <div class="svc-name">${s.name}</div>
      <div class="svc-price">Rs. ${s.price}</div>
      <div class="svc-dur">${s.duration}</div>
    </div>`).join('');
}
function pickService(el, name, price, icon) {
  document.querySelectorAll('.svc-card').forEach(c => c.classList.remove('picked'));
  el.classList.add('picked');
  booking.service=name; booking.servicePrice=price; booking.serviceIcon=icon;
  booking.subService=null;
  const subs = SUB_SERVICES[name] || [];
  const existing = document.getElementById('subOptRow');
  if (existing) existing.remove();
  if (subs.length) {
    const row = document.createElement('div');
    row.id='subOptRow';
    row.innerHTML='<div class="label" style="margin-top:16px;margin-bottom:8px">Select style:</div><div class="sub-opts">'+subs.map(sub=>`<span class="sub-opt" onclick="pickSubService(this,'${sub}')">${sub}</span>`).join('')+'</div>';
    el.closest('.book-sec').appendChild(row);
  }
  updateLiveSummary();
}
function pickSubService(el, name) {
  document.querySelectorAll('.sub-opt').forEach(s => s.classList.remove('picked'));
  el.classList.add('picked'); booking.subService=name; updateLiveSummary();
}
async function renderSeatGrid() {
  let seats;
  if (currentBookingSaloon) {
    const { data } = await _supabase.from('seats').select('*').eq('saloon_id', currentBookingSaloon.id).order('seat_number');
    seats = (data||[]).map(s=>({ num:s.seat_number, status:s.status }));
  } else {
    seats=[1,2,3,4,5,6].map((n,i)=>({ num:n, status:['available','available','occupied','reserved','available','available'][i] }));
  }
  document.getElementById('seatGrid').innerHTML=seats.map(s=>`
    <div class="seat-item ${s.status}" onclick="pickSeat(this,${s.num},'${s.status}')" title="Seat ${s.num}">
      ${s.status==='available'?'🟢':s.status==='occupied'?'🔴':'🟡'} ${s.num}
    </div>`).join('');
}
function pickSeat(el, num, status) {
  if (status==='occupied') { toast('This seat is occupied','error'); return; }
  document.querySelectorAll('.seat-item').forEach(s => s.classList.remove('picked'));
  el.classList.add('picked'); booking.seat=num; updateLiveSummary();
}
function renderSlotGrid() {
  const times=['9:00 AM','9:30 AM','10:00 AM','10:30 AM','11:00 AM','11:30 AM','12:00 PM','1:00 PM','1:30 PM','2:00 PM','2:30 PM','3:00 PM','3:30 PM','4:00 PM','5:00 PM','5:30 PM','6:00 PM','6:30 PM','7:00 PM'];
  document.getElementById('slotGrid').innerHTML=times.map(t=>`<span class="slot" onclick="pickSlot(this,'${t}')">${t}</span>`).join('');
}
function pickSlot(el, time) {
  document.querySelectorAll('.slot').forEach(s=>s.classList.remove('picked'));
  el.classList.add('picked'); booking.slot=time; updateLiveSummary();
}
async function renderBarberGrid() {
  let emps=[];
  if (currentBookingSaloon) {
    const { data } = await _supabase.from('employees').select('*').eq('saloon_id', currentBookingSaloon.id);
    emps=data||[];
  } else {
    emps=[{name:'Usman Sheikh',role:'Senior Barber',rating:4.9,status:'available',avatar:'US'},{name:'Ahmad Raza',role:'Barber',rating:4.7,status:'available',avatar:'AR'}];
  }
  document.getElementById('barberGrid').innerHTML=`
    <div class="barber-card picked" onclick="bookPickBarber(this,'Any Available')">
      <div class="barber-av">🎲</div><div class="barber-name">Any Available</div><div class="barber-role">Auto-assign</div>
    </div>`+emps.map(e=>`
    <div class="barber-card" onclick="bookPickBarber(this,'${e.name}')">
      <div class="barber-av">${e.avatar||'AB'}</div>
      <div class="barber-name">${e.name}</div>
      <div class="barber-role">${e.role||'Barber'}</div>
      <div class="barber-rating">★ ${e.rating||4.5}</div>
      <div style="font-size:12px;color:${e.status==='available'?'var(--g2)':'var(--red)'};margin-top:4px">${e.status==='available'?'Available':'Busy'}</div>
    </div>`).join('');
  booking.barber='Any Available';
}
function bookPickBarber(el, name) {
  document.querySelectorAll('.barber-card').forEach(b => b.classList.remove('picked'));
  el.classList.add('picked');
  booking.barber = name;
  updateLiveSummary();
}
function pickPM(el) {
  document.querySelectorAll('.pm').forEach(p => p.classList.remove('picked'));
  el.classList.add('picked');
  booking.payment = el.dataset.pm;
  document.getElementById('cardFields').style.display = booking.payment==='card' ? 'block' : 'none';
}
function goStep(n) {
  if (n > 1 && !booking.service) { toast('Please select a service first','error'); return; }
  if (n > 2 && !booking.slot) { toast('Please pick a time slot','error'); return; }
  if (n > 3 && !booking.barber) { toast('Please select a barber','error'); return; }
  document.querySelectorAll('.step-section').forEach(s => s.classList.remove('active'));
  document.getElementById('step'+n).classList.add('active');
  currentStep = n;
  document.getElementById('bookStepCount').textContent = 'Step '+n+' of 4';
  booking.date = document.getElementById('bookDate')?.value || booking.date;
  updateStepUI();
  if (n === 4) renderFinalSummary();
  window.scrollTo(0,0);
}
function updateStepUI() {
  for (let i=1;i<=4;i++) {
    const ps=document.getElementById('ps'+i), pl=document.getElementById('pl'+i);
    if(!ps) continue;
    ps.classList.remove('active','done');
    if(i<currentStep) ps.classList.add('done');
    if(i===currentStep) ps.classList.add('active');
    if(pl && i<currentStep) pl.classList.add('done'); else if(pl) pl.classList.remove('done');
  }
}
function updateLiveSummary() {
  const el = document.getElementById('liveSummary'); if(!el) return;
  const parts = [];
  if (booking.service) parts.push(`<div style="margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid var(--border)"><strong>${booking.serviceIcon} ${booking.service}</strong>${booking.subService?'<br><span style="color:var(--text3);font-size:13px">'+booking.subService+'</span>':''}<br><span style="color:var(--p);font-weight:700">Rs. ${booking.servicePrice||'—'}</span></div>`);
  if (booking.date) parts.push(`<div style="font-size:13px;margin-bottom:4px">📅 ${booking.date}</div>`);
  if (booking.slot) parts.push(`<div style="font-size:13px;margin-bottom:4px">⏰ ${booking.slot}</div>`);
  if (booking.seat) parts.push(`<div style="font-size:13px;margin-bottom:4px">🪑 Seat #${booking.seat}</div>`);
  if (booking.barber) parts.push(`<div style="font-size:13px;margin-bottom:4px">✂️ ${booking.barber}</div>`);
  el.innerHTML = parts.length ? parts.join('') : '<span style="color:var(--text4)">No selections yet.</span>';
}
function renderFinalSummary() {
  const salonName=currentBookingSaloon?.name||'Royal Cuts Studio';
  const rows=document.getElementById('summaryRows'); if(!rows) return;
  rows.innerHTML=[
    ['Saloon',salonName],['Service',(booking.serviceIcon||'')+(booking.service||'—')],
    ['Style',booking.subService||'—'],['Barber',booking.barber||'—'],
    ['Date & Time',(booking.date||'—')+' at '+(booking.slot||'—')],
    ['Seat',booking.seat?'#'+booking.seat:'—'],['Payment',booking.payment||'—']
  ].map(([k,v])=>`<div class="sum-row"><div style="font-size:13px;color:var(--text3)">${k}</div><div style="font-weight:600">${v}</div></div>`).join('');
  document.getElementById('sumTotal').textContent='Rs. '+(booking.servicePrice||0);
}
async function confirmBooking() {
  if (!booking.service||!booking.slot) { toast('Please complete all booking steps','error'); return; }
  const btn = document.getElementById('confirmBookingBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating Booking...'; }
  const salonName=currentBookingSaloon?.name||'Royal Cuts Studio';
  const { error } = await _supabase.from('bookings').insert({
    user_id:currentUser.id, saloon_id:currentBookingSaloon?.id||null, saloon_name:salonName,
    customer_name: currentUser.firstName + ' ' + (currentUser.lastName||''),
    service:booking.service, sub_service:booking.subService, barber:booking.barber,
    date:booking.date, time:booking.slot, price:booking.servicePrice||300,
    status:'confirmed', payment_method:booking.payment
  });
  if (error) {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Confirm Booking'; }
    toast('Booking failed: '+error.message,'error'); return;
  }
  if (btn) { btn.innerHTML = '<i class="fas fa-check-circle"></i> Booked!'; }
  toast('🎉 Booking confirmed! See you at '+salonName+'.','gold');
  const bookingRef = 'TT-' + Date.now().toString(36).toUpperCase().slice(-6);
  _sendBookingEmail(
    currentUser.email, currentUser.firstName,
    bookingRef, salonName,
    booking.service, booking.barber,
    booking.date, booking.slot,
    booking.payment, booking.servicePrice || 300
  );
  setTimeout(()=>showPage('pgUserDash'), 800);
}

// ════ USER DASHBOARD ════
async function refreshUserDash() {
  if (!currentUser) return;
  const [{ data: bookings }, { data: myReviews }] = await Promise.all([
    _supabase.from('bookings').select('*').eq('user_id', currentUser.id).order('created_at',{ascending:false}),
    _supabase.from('reviews').select('booking_id').eq('reviewer_id', currentUser.id)
  ]);
  _reviewedBookingIds = new Set((myReviews||[]).map(r => r.booking_id));
  const mine=bookings||[];
  const totalSpent=mine.reduce((a,b)=>a+(b.price||0),0);
  const hour=new Date().getHours();
  const greet=hour<12?'Morning':hour<17?'Afternoon':'Evening';
  document.getElementById('userGreeting').textContent=`Good ${greet}, ${currentUser.firstName}!`;
  const upcoming=mine.filter(b=>b.status==='confirmed'||b.status==='pending');
  if (upcoming.length) {
    const next=upcoming[0];
    document.getElementById('userNextAppt').innerHTML=`Next appointment: <strong>${next.saloon_name||'Salon'}</strong> on ${next.date} at ${next.time}.`;
  }
  document.getElementById('statTotal').textContent=mine.length;
  document.getElementById('statTotalBadge').textContent=mine.length+' total';
  document.getElementById('statSpent').textContent='Rs. '+totalSpent.toLocaleString();
  document.getElementById('statSpentBadge').textContent='Rs. '+totalSpent.toLocaleString();
  document.getElementById('userBookingsBadge').textContent=mine.length;
  document.getElementById('userAv').textContent=(currentUser.firstName[0]+(currentUser.lastName?.[0]||'')).toUpperCase();
  document.getElementById('userName').textContent=currentUser.firstName+' '+(currentUser.lastName||'');
  document.getElementById('userDashDate').textContent=new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  document.getElementById('profName').value=currentUser.firstName+' '+(currentUser.lastName||'');
  document.getElementById('profEmail').value=currentUser.email;
  document.getElementById('profPhone').value=currentUser.phone||'';
  document.getElementById('profCity').value=currentUser.city||'';
  document.getElementById('profAvatar').textContent=(currentUser.firstName[0]+(currentUser.lastName?.[0]||'')).toUpperCase();
  renderRecentBookings(mine); renderAllBookings(mine); renderFavCards();
}
function renderBookingItem(b, showActions=false) {
  const sName = b.saloon_name || b.saloon || '—';
  const alreadyReviewed = _reviewedBookingIds.has(b.id);
  return `<div class="booking-item">
    <div class="bi-icon"><i class="fas fa-scissors"></i></div>
    <div class="bi-info">
      <div class="bi-name">${sName}</div>
      <div class="bi-meta">${b.service||'—'}${b.sub_service?' · '+b.sub_service:''} · ${b.barber||'—'}</div>
      <div class="bi-meta" style="margin-top:2px"><i class="fas fa-calendar" style="font-size:11px"></i> ${b.date||'—'} &nbsp;<i class="fas fa-clock" style="font-size:11px"></i> ${b.time||'—'}</div>
    </div>
    <div class="bi-right">
      <div class="bi-price">Rs. ${b.price||0}</div>
      <span class="badge ${b.status}">● ${b.status}</span>
      ${b.status==='completed' && showActions && !alreadyReviewed ? `<button class="btn btn-xs btn-outline" onclick="openRatingModal('${sName.replace(/'/g,"\\'")}','${b.id}','${(b.barber||'').replace(/'/g,"\\'")}')"><i class="fas fa-star"></i> Rate</button>` : ''}
      ${b.status==='completed' && showActions && alreadyReviewed ? `<span style="font-size:12px;color:var(--g2);font-weight:600"><i class="fas fa-check"></i> Reviewed</span>` : ''}
      ${(b.status==='confirmed'||b.status==='pending') && showActions ? `<button class="btn btn-xs btn-danger" onclick="cancelBooking('${b.id}')">Cancel</button>` : ''}
    </div>
  </div>`;
}
function renderRecentBookings(mine) {
  const el=document.getElementById('recentBookings');
  el.innerHTML=mine.slice(0,3).length?mine.slice(0,3).map(b=>renderBookingItem(b,true)).join(''):'<div style="color:var(--text3);font-size:14px;padding:24px;text-align:center">No bookings yet. <a style="color:var(--p);cursor:pointer;font-weight:600" onclick="showPage(\'pgBooking\')">Book your first!</a></div>';
}
let userBkFilter='all';
async function filterUserBks(f, el) {
  userBkFilter=f;
  document.querySelectorAll('#subBookings .chip').forEach(c=>c.classList.remove('on'));
  el.classList.add('on');
  const { data: bookings } = await _supabase.from('bookings').select('*').eq('user_id',currentUser?.id).order('created_at',{ascending:false});
  renderAllBookings(bookings||[]);
}
function renderAllBookings(mine) {
  const el=document.getElementById('allBookingsList');
  const filtered=userBkFilter==='all'?mine:mine.filter(b=>b.status===userBkFilter);
  el.innerHTML=filtered.length?filtered.map(b=>renderBookingItem(b,true)).join(''):'<div style="color:var(--text3);font-size:14px;padding:24px;text-align:center">No bookings in this category.</div>';
}
async function renderFavCards() {
  const { data: saloons } = await _supabase.from('saloons').select('*').limit(3);
  document.getElementById('favCards').innerHTML=(saloons||[]).map(s=>`
    <div class="salon-card" onclick="bookSaloon('${s.id}')">
      <div class="salon-img" style="${s.image_url?'background:none;padding:0':''}">
        ${s.image_url?`<img src="${s.image_url}" style="width:100%;height:100%;object-fit:cover">`:`<i class="fas fa-scissors" style="font-size:40px;color:var(--p)"></i>`}
        <div class="salon-status${s.is_open?'':' closed'}">${s.is_open?'Open':'Closed'}</div>
      </div>
      <div class="salon-body">
        <div class="salon-name">${s.name}</div>
        <div class="salon-loc"><i class="fas fa-location-dot" style="color:var(--p);margin-right:4px"></i>${s.area||'Lahore'}</div>
        <div class="salon-meta"><span class="salon-rating">★ ${s.rating||4.5}</span><span>(${s.reviews||0})</span></div>
        <div class="salon-foot"><div class="salon-price">From <strong>Rs. ${s.price_from||300}</strong></div><button class="btn btn-sm" style="pointer-events:none">Book</button></div>
      </div>
    </div>`).join('');
}
async function cancelBooking(id) {
  if (!confirm('Cancel this booking?')) return;
  await _supabase.from('bookings').update({ status:'cancelled' }).eq('id',id);
  refreshUserDash(); toast('Booking cancelled.','info');
}
async function saveProfile() {
  const name=document.getElementById('profName').value.trim().split(' ');
  const phone=document.getElementById('profPhone').value;
  const city=document.getElementById('profCity').value;
  await _supabase.from('profiles').update({ first_name:name[0], last_name:name.slice(1).join(' '), phone, city }).eq('id',currentUser.id);
  currentUser.firstName=name[0]; currentUser.lastName=name.slice(1).join(' ');
  currentUser.phone=phone; currentUser.city=city;
  toast('Profile updated!','success'); refreshUserDash();
}
function showUserSub(id) {
  document.querySelectorAll('#pgUserDash .sub-page').forEach(p=>p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelectorAll('#userSidebar .nav-link').forEach(l=>l.classList.remove('active'));
}

// ════ OWNER DASHBOARD ════
async function refreshOwnerDash() {
  if (!currentSaloon) return;
  const { data: bookings } = await _supabase.from('bookings').select('*').eq('saloon_id', currentSaloon.id).order('created_at',{ascending:false});
  const bks=bookings||[];
  _cachedOwnerBookings=bks;
  const today=new Date().toISOString().split('T')[0];
  const todayBks=bks.filter(b=>b.date===today);
  const revenue=bks.filter(b=>b.status==='completed').reduce((a,b)=>a+(b.price||0),0);
  document.getElementById('ownerToday').textContent=todayBks.length;
  document.getElementById('ownerRevenue').textContent='Rs. '+revenue.toLocaleString();
  document.getElementById('ownerBannerMsg').innerHTML=`<strong>${todayBks.length} bookings</strong> today · Revenue: Rs. ${revenue.toLocaleString()}`;
  const activeOwnerBks = bks.filter(b=>b.status==='confirmed'||b.status==='pending');
  document.getElementById('ownerOrdersBadge').textContent = activeOwnerBks.length || '';
  document.getElementById('ownerDashDate').textContent=new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  ['earnToday','earnMonth','earnTotal'].forEach(id=>{ const el=document.getElementById(id); if(el) el.textContent='Rs. '+revenue.toLocaleString(); });
  if (currentUser) {
    document.getElementById('ownerAv').textContent=(currentUser.firstName[0]+(currentUser.lastName?.[0]||'')).toUpperCase();
    document.getElementById('ownerName').textContent=currentUser.firstName+' '+(currentUser.lastName||'');
  }
  const { count: empCount } = await _supabase.from('employees').select('*',{count:'exact',head:true}).eq('saloon_id',currentSaloon.id);
  document.getElementById('ownerSeats').textContent = empCount || 0;
  renderOwnerOrdersTable(bks.slice(0,5));
  renderOwnerOrders(); renderServicesList(); renderOwnerSeatGrid();
  renderEmployeeList(); renderOwnerEarnings(bks); renderPopularServices(bks);
  shopIsOpen=currentSaloon.is_open??true; updateShopToggle();
  const ic=document.getElementById('inviteCode'); if(ic) ic.textContent=currentSaloon.invoke_code||currentSaloon.invite_code||'TT-XXXX-0000';
  const approvalStatus = currentSaloon.approval_status;
  if (approvalStatus && approvalStatus !== 'approved') {
    _watchApprovalStatus();
    if (approvalStatus === 'pending') {
      document.querySelectorAll('#pgOwnerDash .sub-page').forEach(p=>p.classList.remove('active'));
      const waitEl = document.getElementById('oApprovalWait');
      if (waitEl) { waitEl.classList.add('active'); _updateApprovalWaitPage(approvalStatus); }
    } else {
      showOwnerSub('oSettings');
    }
  } else {
    _clearApprovalWatcher();
  }
}
function renderPopularServices(bookings) {
  const el=document.getElementById('popularServices'); if(!el) return;
  const svcCount={};
  bookings.forEach(b=>{ if(b.service) svcCount[b.service]=(svcCount[b.service]||0)+1; });
  const sorted=Object.entries(svcCount).sort((a,b)=>b[1]-a[1]).slice(0,3);
  el.innerHTML=sorted.map(([name,count],i)=>`
    <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:20px">✂️</span>
      <div style="flex:1"><div style="font-weight:600;font-size:14px">${name}</div><div style="font-size:12px;color:var(--text3)">${count} bookings</div></div>
      <div style="font-weight:700;color:var(--p)">#${i+1}</div>
    </div>`).join('')||'<p style="color:var(--text3);font-size:14px">No data yet.</p>';
}
function renderOwnerOrdersTable(orders) {
  const el=document.getElementById('ownerOrdersTable'); if(!el) return;
  el.innerHTML=orders.map(b=>{
    const cust=b.customer_name||'Customer';
    return `<tr><td>${cust}</td><td>${b.service||'—'}</td><td style="white-space:nowrap">${b.date||'—'} ${b.time||''}</td><td style="color:var(--p);font-weight:700">Rs. ${b.price||0}</td><td><span class="badge ${b.status}">● ${b.status}</span></td></tr>`;
  }).join('');
}
function renderOwnerOrders() {
  const el=document.getElementById('allOrdersTable'); if(!el) return;
  const filter=document.getElementById('orderFilter')?.value||'all';
  const filtered=filter==='all'?_cachedOwnerBookings:_cachedOwnerBookings.filter(b=>b.status===filter);
  el.innerHTML=filtered.map(b=>{
    const cust=b.customer_name||'Customer';
    return `<tr><td>${cust}</td><td>${b.service||'—'}</td><td>${b.barber||'—'}</td><td style="white-space:nowrap">${b.date||'—'} ${b.time||''}</td><td style="color:var(--p);font-weight:700">Rs. ${b.price||0}</td><td><span class="badge ${b.status}">● ${b.status}</span></td>
    <td>${b.status==='confirmed'?`<button class="btn btn-xs" onclick="updateBookingStatus('${b.id}','completed')">Done</button>`:b.status==='pending'?`<button class="btn btn-xs btn-outline" onclick="updateBookingStatus('${b.id}','confirmed')">Confirm</button>`:''}</td></tr>`;
  }).join('');
}
async function updateBookingStatus(id, status) {
  await _supabase.from('bookings').update({ status }).eq('id',id);
  refreshOwnerDash(); toast('Booking marked as '+status,'success');
}
async function renderServicesList() {
  if (!currentSaloon) return;
  const { data: services } = await _supabase.from('services').select('*').eq('saloon_id',currentSaloon.id);
  const el=document.getElementById('servicesList'); if(!el) return;
  el.innerHTML=(services||[]).map(s=>`
    <div class="svc-row">
      <div class="svc-row-icon">${s.icon||'✂️'}</div>
      <div class="svc-row-info"><div class="svc-row-name">${s.name}</div><div class="svc-row-price">Rs. ${s.price} · ${s.duration}</div></div>
      <button class="svc-toggle${s.active?'':' off'}" onclick="toggleService('${s.id}')">${s.active?'Active':'Inactive'}</button>
      <button class="btn btn-xs btn-danger" style="margin-left:8px" onclick="deleteService('${s.id}')">✕</button>
    </div>`).join('')||'<p style="color:var(--text3);font-size:14px;padding:12px 0">No services yet. Add one above.</p>';
}
async function toggleService(id) {
  const { data: svc } = await _supabase.from('services').select('active').eq('id',id).single();
  if (svc) await _supabase.from('services').update({ active:!svc.active }).eq('id',id);
  renderServicesList();
}
async function deleteService(id) {
  if (!confirm('Delete this service?')) return;
  await _supabase.from('services').delete().eq('id',id);
  renderServicesList(); toast('Service removed.','info');
}
function openAddServiceModal() { document.getElementById('addServiceModal').classList.add('show'); }
async function addService() {
  const name=document.getElementById('svcName').value.trim();
  const icon=document.getElementById('svcIcon').value.trim()||'✂️';
  const price=parseInt(document.getElementById('svcPrice').value)||0;
  const duration=document.getElementById('svcDuration').value.trim()||'30 min';
  if (!name) { toast('Enter a service name','error'); return; }
  if (!currentSaloon) { toast('No salon found','error'); return; }
  await _supabase.from('services').insert({ saloon_id:currentSaloon.id, icon, name, price, duration, active:true });
  closeModal('addServiceModal'); renderServicesList(); toast('Service added!','success');
  ['svcName','svcPrice','svcDuration'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  document.getElementById('svcIcon').value='✂️';
}
async function renderOwnerSeatGrid() {
  if (!currentSaloon) return;
  const { data: seats } = await _supabase.from('seats').select('*').eq('saloon_id',currentSaloon.id).order('seat_number');
  const el=document.getElementById('ownerSeatGrid'); if(!el) return;
  el.innerHTML=(seats||[]).map(s=>`
    <div class="owner-seat-item ${s.status}" onclick="ownerToggleSeat('${s.id}','${s.status}')">
      ${s.status==='available'?'🪑':s.status==='occupied'?'🚫':'🔒'}
      <span>Seat ${s.seat_number}</span>
    </div>`).join('');
}
async function ownerToggleSeat(id, currentStatus) {
  const cycle={available:'occupied',occupied:'reserved',reserved:'available'};
  await _supabase.from('seats').update({ status:cycle[currentStatus]||'available' }).eq('id',id);
  renderOwnerSeatGrid();
}
async function renderEmployeeList() {
  if (!currentSaloon) return;
  const { data: emps } = await _supabase.from('employees').select('*').eq('saloon_id',currentSaloon.id);
  const el=document.getElementById('employeeList'); if(!el) return;
  el.innerHTML=(emps||[]).map(e=>`
    <div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1.5px solid var(--border)">
      <div class="ua green" style="width:40px;height:40px;font-size:13px;flex-shrink:0">${e.avatar||'AB'}</div>
      <div style="flex:1"><div style="font-size:15px;font-weight:700">${e.name||'—'}</div><div style="font-size:13px;color:var(--text3)">${e.role||'Barber'} · ★ ${e.rating||4.5}</div></div>
      <span class="badge ${e.status==='available'?'confirmed':'pending'}">● ${e.status||'available'}</span>
    </div>`).join('')||'<p style="color:var(--text3);font-size:14px;padding:16px 0">No employees yet.</p>';
}
function renderOwnerEarnings(bookings) {
  const el=document.getElementById('earningsBreakdown'); if(!el) return;
  const svcs={};
  bookings.filter(b=>b.status==='completed').forEach(b=>{ svcs[b.service]=(svcs[b.service]||0)+(b.price||0); });
  el.innerHTML=Object.entries(svcs).map(([k,v])=>`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--border)">
      <div style="font-size:14px;font-weight:500">✂️ ${k}</div>
      <div style="font-weight:700;color:var(--p)">Rs. ${v.toLocaleString()}</div>
    </div>`).join('')||'<div style="color:var(--text3);font-size:14px;padding:16px 0">No completed bookings yet.</div>';
}
async function genCode() {
  const c='ABCDEFGHJKLMNPQRSTUVWXYZ',n='0123456789';
  let code='TT-';
  for(let i=0;i<4;i++) code+=c[Math.floor(Math.random()*c.length)];
  code+='-';
  for(let i=0;i<4;i++) code+=n[Math.floor(Math.random()*n.length)];
  if (currentSaloon) { await _supabase.from('saloons').update({ invite_code:code }).eq('id',currentSaloon.id); currentSaloon.invite_code=code; }
  const el=document.getElementById('inviteCode'); if(el) el.textContent=code;
  toast('New code generated!','success');
}
function copyCode() {
  const el=document.getElementById('inviteCode');
  if(el) navigator.clipboard.writeText(el.textContent).then(()=>toast('Invite code copied!','success'));
}
async function toggleShop() {
  shopIsOpen=!shopIsOpen;
  if (currentSaloon) await _supabase.from('saloons').update({ is_open:shopIsOpen }).eq('id',currentSaloon.id);
  updateShopToggle();
  toast(shopIsOpen?'Shop is now Open 🟢':'Shop is now Closed 🔴',shopIsOpen?'success':'error');
}
function updateShopToggle() {
  const btn=document.getElementById('shopToggle'),dot=document.getElementById('shopDot'),txt=document.getElementById('shopTxt');
  if(!btn) return;
  btn.classList.toggle('on',shopIsOpen); btn.classList.toggle('off-red',!shopIsOpen);
  dot.classList.toggle('on',shopIsOpen); dot.classList.toggle('off',!shopIsOpen);
  txt.textContent=shopIsOpen?'Shop Open':'Shop Closed';
}
function showOwnerSub(id) {
  const status = currentSaloon?.approval_status;
  const isApproved = !status || status === 'approved';
  if (!isApproved && id !== 'oSettings') {
    document.querySelectorAll('#pgOwnerDash .sub-page').forEach(p=>p.classList.remove('active'));
    const waitEl = document.getElementById('oApprovalWait');
    if (waitEl) { waitEl.classList.add('active'); _updateApprovalWaitPage(status); }
    document.querySelectorAll('#ownerSidebar .nav-link').forEach(l=>l.classList.remove('active'));
    return;
  }
  document.querySelectorAll('#pgOwnerDash .sub-page').forEach(p=>p.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
  document.querySelectorAll('#ownerSidebar .nav-link').forEach(l=>l.classList.remove('active'));
  const ic=document.getElementById('inviteCode'); if(ic) ic.textContent=currentSaloon?.invite_code||'TT-XXXX-0000';
  if (id === 'oSettings' && currentSaloon) {
    const set = (eid, val) => { const el = document.getElementById(eid); if (el) el.value = val || ''; };
    set('settSalonName', currentSaloon.name);
    set('settCity',      currentSaloon.city);
    set('settArea',      currentSaloon.area);
    set('settAddress',   currentSaloon.address);
    set('settImageUrl',  currentSaloon.image_url);
    previewSettImg(currentSaloon.image_url || '');
    _updateApprovalSettingsUI(status);
  }
}
function _updateApprovalWaitPage(status) {
  const ico   = document.getElementById('approvalWaitIco');
  const title = document.getElementById('approvalWaitTitle');
  const msg   = document.getElementById('approvalWaitMsg');
  if (!ico || !title || !msg) return;
  if (status === 'pending') {
    ico.innerHTML = '<i class="fas fa-clock"></i>'; ico.style.color = '#f59e0b';
    title.textContent = 'Awaiting Admin Approval';
    msg.textContent = 'Your application is under review. You\'ll have full access once the admin approves your salon.';
  } else if (status === 'declined') {
    ico.innerHTML = '<i class="fas fa-times-circle"></i>'; ico.style.color = 'var(--red)';
    title.textContent = 'Application Declined';
    const reason = currentSaloon?.decline_reason || 'No reason provided.';
    msg.innerHTML = `Your application was declined.<br><br><strong>Reason:</strong> ${reason}<br><br>Go to Settings to update your details and resubmit.`;
  }
}
function _updateApprovalSettingsUI(status) {
  const card    = document.getElementById('approvalStatusCard');
  const actions = document.getElementById('approvalActions');
  if (!card) return;
  if (!status || status === 'approved') { card.style.display='none'; if(actions) actions.style.display='none'; return; }
  card.style.display = 'block';
  if (status === 'draft') {
    card.style.cssText += ';background:var(--p10);border:1.5px solid var(--p20);border-radius:10px;padding:16px';
    card.innerHTML = `<div style="display:flex;align-items:center;gap:12px"><i class="fas fa-info-circle" style="font-size:20px;color:var(--p)"></i><div><div style="font-weight:700;font-size:15px;color:var(--p)">Complete Your Profile</div><div style="font-size:13px;color:var(--text3);margin-top:2px">Fill in your salon details below, then click Apply for Approval.</div></div></div>`;
    if (actions) { actions.style.display='block'; actions.innerHTML='<button class="btn" style="width:100%;justify-content:center" onclick="submitSalonApproval()"><i class="fas fa-paper-plane"></i>&nbsp; Apply for Approval</button>'; }
  } else if (status === 'pending') {
    card.style.cssText += ';background:#fff7ed;border:1.5px solid #fed7aa;border-radius:10px;padding:16px';
    card.innerHTML = `<div style="display:flex;align-items:center;gap:12px"><i class="fas fa-clock" style="font-size:20px;color:#f59e0b"></i><div><div style="font-weight:700;font-size:15px;color:#d97706">Pending Admin Approval</div><div style="font-size:13px;color:var(--text3);margin-top:2px">Your application is under review. Please wait for the admin to approve your salon.</div></div></div>`;
    if (actions) actions.style.display = 'none';
  } else if (status === 'declined') {
    const reason = currentSaloon?.decline_reason || 'No reason provided.';
    card.style.cssText += ';background:var(--red10);border:1.5px solid rgba(239,68,68,.2);border-radius:10px;padding:16px';
    card.innerHTML = `<div style="display:flex;align-items:flex-start;gap:12px"><i class="fas fa-times-circle" style="font-size:20px;color:var(--red);margin-top:2px"></i><div><div style="font-weight:700;font-size:15px;color:var(--red)">Application Declined</div><div style="font-size:13px;color:var(--text3);margin-top:2px"><strong>Reason:</strong> ${reason}</div><div style="font-size:13px;color:var(--text3);margin-top:4px">Update your details below and resubmit.</div></div></div>`;
    if (actions) { actions.style.display='block'; actions.innerHTML='<button class="btn" style="width:100%;justify-content:center" onclick="submitSalonApproval()"><i class="fas fa-paper-plane"></i>&nbsp; Resubmit Application</button>'; }
  }
}
function previewSettImg(url) {
  const box = document.getElementById('settImgPreview');
  const img = document.getElementById('settImgTag');
  if (!box || !img) return;
  if (url) { img.src = url; box.style.display = 'block'; }
  else      { box.style.display = 'none'; }
}
async function saveSalonSettings() {
  const name     = document.getElementById('settSalonName').value.trim();
  const city     = document.getElementById('settCity').value.trim();
  const area     = document.getElementById('settArea').value.trim();
  const address  = document.getElementById('settAddress').value.trim();
  const imageUrl = document.getElementById('settImageUrl').value.trim();
  if (!name) return toast('Salon name is required.', 'error');
  if (!currentSaloon?.id) return toast('No salon found.', 'error');
  const { error } = await _supabase.from('saloons').update({ name, city, area, address, image_url: imageUrl }).eq('id', currentSaloon.id);
  if (error) return toast('Save failed: ' + error.message, 'error');
  currentSaloon = { ...currentSaloon, name, city, area, address, image_url: imageUrl };
  toast('Settings saved!', 'success');
}
async function submitSalonApproval() {
  const name     = document.getElementById('settSalonName').value.trim();
  const city     = document.getElementById('settCity').value.trim();
  const area     = document.getElementById('settArea').value.trim();
  const address  = document.getElementById('settAddress').value.trim();
  const imageUrl = document.getElementById('settImageUrl').value.trim();
  if (!name)       return toast('Please enter your salon name.', 'error');
  if (!city||!area) return toast('Please fill in city and area.', 'error');
  if (!currentSaloon?.id) return;
  const { error } = await _supabase.from('saloons').update({ name, city, area, address, image_url: imageUrl, approval_status: 'pending', decline_reason: null }).eq('id', currentSaloon.id);
  if (error) return toast('Failed: ' + error.message, 'error');
  currentSaloon = { ...currentSaloon, name, city, area, address, image_url: imageUrl, approval_status: 'pending', decline_reason: null };
  toast('Application submitted! Admin will review your salon.', 'success');
  document.querySelectorAll('#pgOwnerDash .sub-page').forEach(p=>p.classList.remove('active'));
  const waitEl = document.getElementById('oApprovalWait');
  if (waitEl) { waitEl.classList.add('active'); _updateApprovalWaitPage('pending'); }
}

// ════ EMPLOYEE DASHBOARD ════
async function refreshEmpDash() {
  if (!currentUser) return;
  const fullName = currentUser.firstName + ' ' + (currentUser.lastName || '');
  const initials = (currentUser.firstName[0] + (currentUser.lastName?.[0] || '')).toUpperCase();
  const { data: emp } = await _supabase.from('employees').select('*, saloons(name)').eq('user_id', currentUser.id).single();
  const jobRole   = emp?.role || 'Barber';
  const salonName = emp?.saloons?.name || currentSaloon?.name || 'TrimTime';
  document.getElementById('empAv').textContent   = initials;
  document.getElementById('empName').textContent = fullName;
  const heroAv = document.getElementById('empHeroAv'); if (heroAv) heroAv.textContent = initials;
  const heroNm = document.getElementById('empHeroName'); if (heroNm) heroNm.textContent = fullName;
  const heroRl = document.getElementById('empHeroRole'); if (heroRl) heroRl.textContent = jobRole + ' · ' + salonName;
  const profAv = document.getElementById('empProfAv');   if (profAv) profAv.textContent = initials;
  const profNm = document.getElementById('empProfName'); if (profNm) profNm.value = fullName;
  const profRl = document.getElementById('empProfRole'); if (profRl) profRl.value = jobRole;
  const profPh = document.getElementById('empProfPhone'); if (profPh) profPh.value = currentUser.phone || '';
  const { data: assigned } = await _supabase.from('bookings').select('*').eq('barber', fullName).order('created_at', {ascending:false});
  const bks       = assigned || [];
  const completed = bks.filter(b => b.status === 'completed');
  const cancelled = bks.filter(b => b.status === 'cancelled');
  const onTimePct = bks.length > 0 ? Math.round((completed.length / bks.length) * 100) : 0;
  const today     = new Date().toISOString().split('T')[0];
  const todayAssigned = bks.filter(b => b.date === today);
  const earnings  = completed.reduce((a, b) => a + (b.price || 0) * 0.6, 0);
  const { data: empReviews } = emp ? await _supabase.from('reviews').select('rating, comment, created_at').eq('employee_id', emp.id).order('created_at', {ascending:false}) : {data:[]};
  const reviewCount = (empReviews||[]).length;
  const avgRating   = reviewCount > 0 ? empReviews.reduce((s,r) => s + r.rating, 0) / reviewCount : null;
  if (avgRating !== null) {
    const heroStars2 = document.getElementById('empHeroStars'); if (heroStars2) heroStars2.textContent = '★'.repeat(Math.round(avgRating)) + '☆'.repeat(5 - Math.round(avgRating));
    const heroRating2 = document.getElementById('empHeroRating'); if (heroRating2) heroRating2.textContent = avgRating.toFixed(1);
  }
  const rc = document.getElementById('empHeroReviewCount'); if (rc) rc.textContent = `(${reviewCount} review${reviewCount !== 1 ? 's' : ''})`;
  const kr = document.getElementById('empKpiReviews');      if (kr) kr.textContent = reviewCount;
  renderEmpReviews(empReviews||[]);
  document.getElementById('empTotalCust').textContent   = bks.length;
  const activeEmpBks = bks.filter(b => b.status === 'confirmed' || b.status === 'pending');
  document.getElementById('empOrdersBadge').textContent = activeEmpBks.length || '';
  document.getElementById('empMonthEarn').textContent   = 'Rs. ' + Math.round(earnings).toLocaleString();
  const ko = document.getElementById('empKpiOnTime');  if (ko) ko.textContent = bks.length > 0 ? onTimePct + '%' : '—';
  const km = document.getElementById('empKpiMissed');  if (km) km.textContent = cancelled.length;
  ['empEarnToday','empEarnMonth','empEarnTotal'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = 'Rs. ' + Math.round(earnings).toLocaleString(); });
  document.getElementById('empDashDate').textContent = new Date().toLocaleDateString('en-US', {weekday:'long', year:'numeric', month:'long', day:'numeric'});
  empIsAvail = STORE.get('available') ?? true; updateAvailToggle();
  renderEmpSchedule(todayAssigned, 'empTodaySchedule');
  renderEmpSchedule(bks, 'empFullSchedule');
  renderEmpOrders(bks);
}
async function saveEmpProfile() {
  if (!currentUser) return;
  const name  = document.getElementById('empProfName')?.value.trim();
  const phone = document.getElementById('empProfPhone')?.value.trim();
  if (!name) { toast('Name cannot be empty', 'error'); return; }
  const parts = name.split(' ');
  const { error } = await _supabase.from('profiles').update({ first_name: parts[0], last_name: parts.slice(1).join(' '), phone }).eq('id', currentUser.id);
  if (error) { toast('Save failed: ' + error.message, 'error'); return; }
  currentUser.firstName = parts[0]; currentUser.lastName = parts.slice(1).join(' '); currentUser.phone = phone;
  toast('Profile saved!', 'success');
  refreshEmpDash();
}
function renderEmpReviews(reviews) {
  const el = document.getElementById('empReviewsList'); if (!el) return;
  if (!reviews.length) {
    el.innerHTML = '<div class="card"><p style="color:var(--text3);text-align:center">No reviews yet. Keep providing great service!</p></div>';
    return;
  }
  el.innerHTML = reviews.map(r => `
    <div class="card" style="margin-bottom:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <span style="color:var(--amber);font-size:18px;letter-spacing:2px">${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)}</span>
        <span style="font-size:12px;color:var(--text3)">${new Date(r.created_at).toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'})}</span>
      </div>
      <p style="font-size:14px;color:var(--text2);line-height:1.5">${r.comment || '<em style="color:var(--text4)">No comment left.</em>'}</p>
    </div>`).join('');
}
function renderEmpSchedule(bookings,elId) {
  const el=document.getElementById(elId); if(!el) return;
  const now=new Date();
  el.innerHTML=bookings.length?bookings.slice(0,8).map(b=>{
    const isPast=new Date(b.date+' '+b.time)<now;
    return `<div class="sch-item ${isPast?'done':'upcoming'}">
      <div class="sch-time">${b.time||'—'}</div>
      <div><div class="sch-name">Customer</div><div class="sch-svc">${b.service||'—'}${b.sub_service?' · '+b.sub_service:''} · ${b.date||'—'}</div></div>
      <span class="badge ${b.status}">● ${b.status}</span>
    </div>`;
  }).join(''):'<div style="color:var(--text3);font-size:14px;padding:16px 0;text-align:center">No appointments scheduled.</div>';
}
function renderEmpOrders(bookings) {
  const el=document.getElementById('empOrdersList'); if(!el) return;
  el.innerHTML=bookings.length?bookings.map(b=>{
    const canComplete = b.status==='confirmed'||b.status==='pending';
    return `
    <div class="booking-item" style="flex-wrap:wrap;gap:8px">
      <div class="bi-icon"><i class="fas fa-scissors" style="font-size:18px;color:var(--p)"></i></div>
      <div class="bi-info" style="flex:1;min-width:160px">
        <div class="bi-name">${b.customer_name||'Customer'} · ${b.service||'—'}${b.sub_service?' ('+b.sub_service+')':''}</div>
        <div class="bi-meta"><i class="fas fa-calendar" style="margin-right:4px"></i>${b.date||'—'} &nbsp;<i class="fas fa-clock" style="margin-right:4px"></i>${b.time||'—'}</div>
      </div>
      <div class="bi-right" style="display:flex;align-items:center;gap:8px">
        <div class="bi-price">Rs. ${Math.round((b.price||0)*0.6)}</div>
        <span class="badge ${b.status}">● ${b.status}</span>
        ${canComplete?`<button class="btn btn-xs" style="white-space:nowrap" onclick="markEmpBookingComplete('${b.id}')"><i class="fas fa-check"></i> Mark Done</button>`:''}
      </div>
    </div>`;
  }).join(''):'<div style="color:var(--text3);font-size:14px;padding:24px;text-align:center">No assigned orders.</div>';
}
async function markEmpBookingComplete(id) {
  await _supabase.from('bookings').update({ status:'completed' }).eq('id', id);
  toast('Booking marked as completed!', 'success');
  refreshEmpDash();
}
function toggleAvailability() {
  empIsAvail=!empIsAvail; STORE.set('available',empIsAvail); updateAvailToggle();
  toast(empIsAvail?'You are now Available ✅':'You are now Unavailable ❌',empIsAvail?'success':'info');
}
function updateAvailToggle() {
  const btn=document.getElementById('availToggle'),dot=document.getElementById('availDot'),txt=document.getElementById('availTxt');
  if(!btn) return;
  btn.classList.toggle('on',empIsAvail); btn.classList.toggle('off-red',!empIsAvail);
  dot.classList.toggle('on',empIsAvail); dot.classList.toggle('off',!empIsAvail);
  txt.textContent=empIsAvail?'Available':'Unavailable';
}
function showEmpSub(id) {
  document.querySelectorAll('#pgEmpDash .sub-page').forEach(p=>p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelectorAll('#empSidebar .nav-link').forEach(l=>l.classList.remove('active'));
}
function setRating(n) {
  empRatingVal=n;
  document.querySelectorAll('#starWidget .star').forEach((s,i)=>{ s.classList.toggle('on',i<n); });
}
function submitRating() {
  const cust=document.getElementById('rateCustomer').value.trim();
  const svc=document.getElementById('rateSvc').value.trim();
  if(!cust){ toast('Enter a customer name','error'); return; }
  toast(`Rated ${cust} — ${empRatingVal}⭐ for ${svc||'service'}`, 'success');
  document.getElementById('rateCustomer').value=''; document.getElementById('rateSvc').value=''; document.getElementById('rateNotes').value='';
}

// ════ MODALS & REVIEWS ════
function openRatingModal(salon, bookingId, barber) {
  _reviewModalBookingId = bookingId;
  document.getElementById('ratingModalSalon').textContent = salon;
  document.getElementById('ratingModalBarber').textContent = barber ? 'Barber: ' + barber : '';
  document.getElementById('ratingReview').value = '';
  modalRating = 0; setModalRating(0);
  document.getElementById('ratingModal').classList.add('show');
}
function openModal(id)  { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }
function setModalRating(n) {
  modalRating = n;
  document.querySelectorAll('#ratingStars .star').forEach((s,i) => s.classList.toggle('on', i < n));
}
async function submitReview() {
  if (!modalRating) { toast('Please select a star rating', 'error'); return; }
  if (!_reviewModalBookingId) { closeModal('ratingModal'); return; }
  const btn = document.getElementById('reviewSubmitBtn');
  btn.classList.add('btn-loading');
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>&nbsp; Submitting...';
  const { data: bk } = await _supabase.from('bookings').select('saloon_id, barber').eq('id', _reviewModalBookingId).single();
  let employeeId = null;
  if (bk?.barber && bk?.saloon_id) {
    const { data: emp } = await _supabase.from('employees').select('id').eq('saloon_id', bk.saloon_id).eq('name', bk.barber).single();
    employeeId = emp?.id || null;
  }
  const { error } = await _supabase.from('reviews').insert({
    booking_id:  _reviewModalBookingId,
    reviewer_id: currentUser.id,
    employee_id: employeeId,
    saloon_id:   bk?.saloon_id || null,
    rating:      modalRating,
    comment:     document.getElementById('ratingReview').value.trim()
  });
  btn.classList.remove('btn-loading'); btn.innerHTML = 'Submit Review';
  if (error) { toast('Could not save review: ' + error.message, 'error'); return; }
  if (employeeId) {
    const { data: allRatings } = await _supabase.from('reviews').select('rating').eq('employee_id', employeeId);
    if (allRatings?.length) {
      const avg = allRatings.reduce((s,r) => s + r.rating, 0) / allRatings.length;
      await _supabase.from('employees').update({ rating: Math.round(avg * 10) / 10 }).eq('id', employeeId);
    }
  }
  _reviewedBookingIds.add(_reviewModalBookingId);
  closeModal('ratingModal');
  toast('Review submitted — thank you!', 'success');
  refreshUserDash();
}

// ════ SIDEBAR ════
function openSidebar(id) {
  document.getElementById(id).classList.add('show');
  document.querySelectorAll('.overlay').forEach(o=>o.classList.add('show'));
}
function closeSidebar(id) {
  document.getElementById(id).classList.remove('show');
  document.querySelectorAll('.overlay').forEach(o=>o.classList.remove('show'));
}

// ════ TOAST ════
function toast(msg, type='info') {
  const el=document.createElement('div');
  el.className='toast '+type; el.textContent=msg;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(()=>el.remove(),3500);
}

// ════ AI ANALYSIS ════
async function runAIAnalysis(type) {
  const el=document.getElementById('aiResponse');
  el.innerHTML='<div class="ai-loading"><div class="ai-dot"></div><div class="ai-dot"></div><div class="ai-dot"></div>&nbsp;Analyzing your business data...</div>';
  const bookings=_cachedOwnerBookings;
  const stats={ totalBookings:bookings.length, completedBookings:bookings.filter(b=>b.status==='completed').length, totalRevenue:bookings.filter(b=>b.status==='completed').reduce((a,b)=>a+(b.price||0),0), topService:Object.entries(bookings.reduce((acc,b)=>{if(b.service) acc[b.service]=(acc[b.service]||0)+1;return acc},{})).sort((a,b)=>b[1]-a[1])[0]?.[0]||'N/A' };
  const prompts={overview:`You are a business analyst for TrimTime, a saloon management platform. Analyze this saloon data and give actionable insights in 3-4 short paragraphs:\n\nData: ${JSON.stringify(stats)}\n\nFocus on: revenue performance, booking trends, and key opportunities. Be specific and practical for a Pakistani saloon owner in Lahore.`,tips:`You are a business growth expert for TrimTime. Given this saloon data: ${JSON.stringify(stats)}\n\nProvide 5 specific, actionable growth tips for increasing bookings and revenue. Format as numbered list. Keep it practical for a Lahore-based saloon.`,peak:`You are a scheduling expert for TrimTime saloon platform. Given this data: ${JSON.stringify(stats)}\n\nAnalyze and recommend:\n1. Likely peak hours for a Lahore saloon\n2. How to optimize staffing\n3. How to handle slow periods\n\nBe specific and practical.`};
  try {
    const response=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:1000,messages:[{role:'user',content:prompts[type]}]})});
    const data=await response.json();
    el.textContent=data.content?.map(c=>c.text||'').join('')||'Unable to generate analysis.';
  } catch(err) {
    el.textContent='AI analysis unavailable. Sample insight: Your saloon has '+stats.totalBookings+' total bookings. Top service: '+stats.topService+'.';
  }
}
async function sendAIQuestion() {
  const q=document.getElementById('aiQuestion').value.trim(); if(!q) return;
  const el=document.getElementById('aiChatResponse');
  el.style.display='block';
  el.innerHTML='<div class="ai-loading"><div class="ai-dot"></div><div class="ai-dot"></div><div class="ai-dot"></div>&nbsp;Thinking...</div>';
  document.getElementById('aiQuestion').value='';
  const stats={totalBookings:_cachedOwnerBookings.length,revenue:_cachedOwnerBookings.filter(b=>b.status==='completed').reduce((a,b)=>a+(b.price||0),0)};
  try {
    const response=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:600,messages:[{role:'user',content:`You are a business advisor for a saloon in Lahore, Pakistan called "${currentSaloon?.name||'Royal Cuts Studio'}" using TrimTime platform. Business stats: ${JSON.stringify(stats)}. Answer this question concisely and practically: ${q}`}]})});
    const data=await response.json();
    el.textContent=data.content?.map(c=>c.text||'').join('')||'No response.';
  } catch(err) { el.textContent='AI unavailable. Please try again later.'; }
}

// ════ APPROVAL WATCHER ════
function _clearApprovalWatcher() {
  if (_approvalChannel)    { _supabase.removeChannel(_approvalChannel); _approvalChannel = null; }
  if (_approvalPollInterval) { clearInterval(_approvalPollInterval); _approvalPollInterval = null; }
}
function _onApprovalStatusChange(newStatus, newSalon) {
  currentSaloon = { ...currentSaloon, ...newSalon };
  if (newStatus === 'approved') {
    _clearApprovalWatcher();
    toast('Your salon has been approved! You now have full access.', 'success');
    refreshOwnerDash();
  } else if (newStatus === 'declined') {
    showOwnerSub('oSettings');
  }
}
function _watchApprovalStatus() {
  if (!currentSaloon?.id) return;
  _clearApprovalWatcher();
  // Real-time subscription (instant)
  _approvalChannel = _supabase
    .channel('salon-approval-' + currentSaloon.id)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'saloons', filter: `id=eq.${currentSaloon.id}` },
      payload => {
        const s = payload.new;
        if (s.approval_status !== currentSaloon.approval_status) _onApprovalStatusChange(s.approval_status, s);
      })
    .subscribe();
  // Polling fallback every 30 seconds
  _approvalPollInterval = setInterval(async () => {
    if (!currentSaloon?.id) { _clearApprovalWatcher(); return; }
    const { data } = await _supabase.from('saloons').select('approval_status,decline_reason').eq('id', currentSaloon.id).single();
    if (data && data.approval_status !== currentSaloon.approval_status) _onApprovalStatusChange(data.approval_status, data);
  }, 30000);
}

// ════ ADMIN DASHBOARD ════
function showAdminSub(id, el) {
  document.querySelectorAll('#pgAdmin .sub-page').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelectorAll('#adminSidebar .nav-link').forEach(l => l.classList.remove('active'));
  if (el) el.classList.add('active');
  if (id === 'adApprovals') renderAdminApprovals();
}
async function refreshAdminDash() {
  const [{ count: saloonCount }, { count: userCount }, { count: bookingCount }] = await Promise.all([
    _supabase.from('saloons').select('*', { count:'exact', head:true }),
    _supabase.from('profiles').select('*', { count:'exact', head:true }),
    _supabase.from('bookings').select('*', { count:'exact', head:true })
  ]);
  const { data: bkgs } = await _supabase.from('bookings').select('price').neq('status','cancelled');
  const revenue = (bkgs||[]).reduce((s,b) => s+(b.price||0), 0);
  document.getElementById('adStatSaloons').textContent = saloonCount||0;
  document.getElementById('adStatUsers').textContent = userCount||0;
  document.getElementById('adStatBookings').textContent = bookingCount||0;
  document.getElementById('adStatRevenue').textContent = 'Rs. '+revenue.toLocaleString();
  renderAdminRecent();
  renderAdminSaloons();
  renderAdminUsers();
  renderAdminBookings();
  const { count: pendingApprovals } = await _supabase.from('saloons').select('*',{count:'exact',head:true}).eq('approval_status','pending');
  const apBadge = document.getElementById('adApprovalsBadge');
  if (apBadge) apBadge.textContent = pendingApprovals || '';
}
async function renderAdminRecent() {
  const { data } = await _supabase.from('bookings').select('*').order('created_at',{ascending:false}).limit(10);
  const el = document.getElementById('adRecentBody');
  if (!el) return;
  if (!data?.length) { el.innerHTML='<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text3)">No bookings yet</td></tr>'; return; }
  el.innerHTML = data.map(b=>`<tr style="border-bottom:1px solid var(--border)">
    <td style="padding:10px 12px">${b.saloon_name||'—'}</td>
    <td style="padding:10px 12px">${b.service||'—'}</td>
    <td style="padding:10px 12px">${b.date||'—'} ${b.time||''}</td>
    <td style="padding:10px 12px">Rs. ${b.price||0}</td>
    <td style="padding:10px 12px"><span class="badge ${b.status}">${b.status}</span></td>
  </tr>`).join('');
}
async function renderAdminSaloons() {
  const { data } = await _supabase.from('saloons').select('*').order('created_at',{ascending:false});
  const el = document.getElementById('adSaloonTable');
  if (!el) return;
  if (!data?.length) { el.innerHTML='<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text3)">No saloons yet</td></tr>'; return; }
  el.innerHTML = data.map(s=>`<tr style="border-bottom:1px solid var(--border)">
    <td style="padding:10px 12px"><i class="fas fa-scissors" style="color:var(--p);margin-right:6px"></i><strong>${s.name}</strong></td>
    <td style="padding:10px 12px">${s.area||'—'}, ${s.city||'—'}</td>
    <td style="padding:10px 12px">${s.rating}⭐ (${s.reviews})</td>
    <td style="padding:10px 12px">Rs. ${s.price_from}</td>
    <td style="padding:10px 12px"><span class="badge ${s.is_suspended?'cancelled':(s.is_open?'active':'')}">${s.is_suspended?'Suspended':(s.is_open?'Open':'Closed')}</span></td>
    <td style="padding:10px 12px;display:flex;gap:6px;flex-wrap:wrap">
      <button class="btn btn-xs ${s.is_suspended?'btn-outline':'btn-warning'}" onclick="adminToggleSalonSuspend('${s.id}',${!!s.is_suspended})">${s.is_suspended?'<i class=\'fas fa-check\'></i> Unsuspend':'<i class=\'fas fa-ban\'></i> Suspend'}</button>
      <button class="btn btn-danger btn-xs" onclick="adminDeleteSaloon('${s.id}')"><i class="fas fa-trash"></i> Delete</button>
    </td>
  </tr>`).join('');
}
async function renderAdminUsers() {
  const { data } = await _supabase.from('profiles').select('*').order('created_at',{ascending:false});
  const el = document.getElementById('adUserTable');
  if (!el) return;
  if (!data?.length) { el.innerHTML='<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text3)">No users yet</td></tr>'; return; }
  el.innerHTML = data.map(u=>`<tr style="border-bottom:1px solid var(--border)">
    <td style="padding:10px 12px">${u.first_name||''} ${u.last_name||''}</td>
    <td style="padding:10px 12px">${u.phone||'—'}</td>
    <td style="padding:10px 12px"><span class="badge ${u.role}">${u.role}</span></td>
    <td style="padding:10px 12px">${u.city||'—'}</td>
    <td style="padding:10px 12px">${new Date(u.created_at).toLocaleDateString()}</td>
    <td style="padding:10px 12px"><span class="badge ${u.is_suspended?'cancelled':'active'}">${u.is_suspended?'Suspended':'Active'}</span></td>
    <td style="padding:10px 12px">${u.role==='admin'?'<span style="color:var(--text3);font-size:12px">—</span>':`<button class="btn btn-xs ${u.is_suspended?'btn-outline':'btn-warning'}" onclick="adminToggleUserSuspend('${u.id}',${!!u.is_suspended})">${u.is_suspended?'<i class=\'fas fa-check\'></i> Unsuspend':'<i class=\'fas fa-ban\'></i> Suspend'}</button>`}</td>
  </tr>`).join('');
}
async function renderAdminBookings() {
  const { data } = await _supabase.from('bookings').select('*').order('created_at',{ascending:false}).limit(100);
  const el = document.getElementById('adBookingTable');
  if (!el) return;
  if (!data?.length) { el.innerHTML='<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text3)">No bookings yet</td></tr>'; return; }
  el.innerHTML = data.map(b=>`<tr style="border-bottom:1px solid var(--border)">
    <td style="padding:10px 12px">${b.saloon_name||'—'}</td>
    <td style="padding:10px 12px">${b.service||'—'}</td>
    <td style="padding:10px 12px">${b.barber||'—'}</td>
    <td style="padding:10px 12px">${b.date||'—'} ${b.time||''}</td>
    <td style="padding:10px 12px">Rs. ${b.price||0}</td>
    <td style="padding:10px 12px"><span class="badge ${b.status}">${b.status}</span></td>
  </tr>`).join('');
}
async function adminDeleteSaloon(id) {
  if (!confirm('Delete this salon and all its data? This cannot be undone.')) return;
  await _supabase.from('saloons').delete().eq('id', id);
  toast('Salon deleted','success');
  renderAdminSaloons();
}
async function adminToggleSalonSuspend(id, isSuspended) {
  const action = isSuspended ? 'unsuspend' : 'suspend';
  if (!confirm(`${isSuspended?'Unsuspend':'Suspend'} this salon? ${isSuspended?'It will reappear on the Discover page.':'It will be hidden from customers.'}`)) return;
  await _supabase.from('saloons').update({ is_suspended: !isSuspended }).eq('id', id);
  toast(`Salon ${action}ed`, 'success');
  renderAdminSaloons();
}
async function adminToggleUserSuspend(id, isSuspended) {
  const action = isSuspended ? 'unsuspend' : 'suspend';
  if (!confirm(`${isSuspended?'Unsuspend':'Suspend'} this user? ${isSuspended?'They will be able to log in again.':'They will be blocked from logging in.'}`)) return;
  await _supabase.from('profiles').update({ is_suspended: !isSuspended }).eq('id', id);
  toast(`User ${action}ed`, 'success');
  renderAdminUsers();
}
async function renderAdminApprovals() {
  const { data } = await _supabase.from('saloons').select('*').eq('approval_status','pending').order('created_at',{ascending:true});
  const el = document.getElementById('approvalsList');
  if (!el) return;
  const apBadge = document.getElementById('adApprovalsBadge');
  if (apBadge) apBadge.textContent = data?.length || '';
  if (!data?.length) {
    el.innerHTML = '<div class="card" style="text-align:center;padding:48px"><i class="fas fa-check-circle" style="font-size:48px;color:var(--g2);display:block;margin-bottom:12px"></i><p style="color:var(--text3)">No pending approvals</p></div>';
    return;
  }
  el.innerHTML = data.map(s=>`
    <div class="card" style="margin-bottom:16px">
      <div style="display:flex;gap:20px;flex-wrap:wrap;align-items:flex-start">
        ${s.image_url?`<img src="${s.image_url}" style="width:130px;height:96px;object-fit:cover;border-radius:10px;flex-shrink:0" onerror="this.style.display='none'">` : '<div style="width:130px;height:96px;border-radius:10px;background:var(--p10);display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="fas fa-scissors" style="font-size:32px;color:var(--p)"></i></div>'}
        <div style="flex:1;min-width:180px">
          <div style="font-family:\'Poppins\',sans-serif;font-size:18px;font-weight:700;margin-bottom:6px">${s.name}</div>
          <div style="font-size:13px;color:var(--text3);margin-bottom:3px"><i class="fas fa-location-dot" style="width:14px"></i> ${s.area||'—'}, ${s.city||'—'}</div>
          ${s.address?`<div style="font-size:13px;color:var(--text3);margin-bottom:3px"><i class="fas fa-map-pin" style="width:14px"></i> ${s.address}</div>`:''}
          <div style="font-size:12px;color:var(--text3);margin-top:4px"><i class="fas fa-calendar" style="width:14px"></i> Applied: ${new Date(s.created_at).toLocaleDateString()}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <button class="btn btn-sm" style="background:var(--g2)" onclick="adminApproveSalon('${s.id}')"><i class="fas fa-check"></i> Approve</button>
          <button class="btn btn-sm btn-danger" onclick="adminDeclineSalon('${s.id}')"><i class="fas fa-times"></i> Decline</button>
        </div>
      </div>
    </div>`).join('');
}
async function adminApproveSalon(id) {
  await _supabase.from('saloons').update({ approval_status:'approved', decline_reason:null }).eq('id', id);
  toast('Salon approved — now live on the platform!', 'success');
  renderAdminApprovals();
  refreshAdminDash();
}
async function adminDeclineSalon(id) {
  const reason = prompt('Enter reason for declining (the owner will see this):');
  if (reason === null) return;
  await _supabase.from('saloons').update({ approval_status:'declined', decline_reason: reason||'Application declined.' }).eq('id', id);
  toast('Salon application declined.', 'info');
  renderAdminApprovals();
  refreshAdminDash();
}

// ════ INIT ════
// ════ SESSION INIT ════
// app_state.js is loaded dynamically so DOMContentLoaded has already fired.
// Run immediately and listen for auth state changes.
(async () => {
  const { data: { session } } = await _supabase.auth.getSession();
  if (session) await loadUserAndRoute(session.user);
})();

_supabase.auth.onAuthStateChange(async (event, session) => {
  if (event === 'SIGNED_IN' && session && !currentUser) {
    await loadUserAndRoute(session.user);
  }
  if (event === 'SIGNED_OUT') {
    currentUser = null; currentSaloon = null;
    _clearApprovalWatcher();
    showPage('pgLanding');
  }
  if (event === 'TOKEN_REFRESHED' && session && currentUser) {
    // session silently refreshed — nothing needed, Supabase handles it
  }
});
