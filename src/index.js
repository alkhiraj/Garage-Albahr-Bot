// =========================================
//  كرت البحر بوت — Cloudflare Worker
//  v4 — wa.me links + Telegram Group
// =========================================

let ENV = {};

const CAR_BRANDS = [
  'تويوتا', 'هوندا', 'نيسان', 'هيونداي', 'كيا', 'سوزوكي',
  'شيفروليه', 'فورد', 'بي إم دبليو', 'مرسيدس بنز', 'لكزس',
  'جيب', 'دودج', 'رام', 'مازدا', 'ميتسوبيشي', 'فولكسفاغن',
  'أودي', 'لاند روفر', 'رنج روفر', 'إنفينيتي', 'جيلي', 'شيري', 'BYD',
];

// ─── Supabase ────────────────────────────────────────
async function sb(method, path, body = null) {
  const res = await fetch(`${ENV.SB_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: ENV.SB_KEY,
      Authorization: `Bearer ${ENV.SB_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation,resolution=merge-duplicates',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`[SB] ${method} ${path} → ${text}`);
  return text ? JSON.parse(text) : [];
}

async function sbPatch(path, body) {
  await fetch(`${ENV.SB_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      apikey: ENV.SB_KEY,
      Authorization: `Bearer ${ENV.SB_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

// ─── Telegram ────────────────────────────────────────
async function tg(method, body) {
  return fetch(`https://api.telegram.org/bot${ENV.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function send(chatId, text, extra = {}) {
  return tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });
}

// ─── wa.me link generator ─────────────────────────────
// يولّد رابط يفتح واتساب مع الرسالة جاهزة
function waLink(phone, message) {
  const num = `966${phone.replace(/^0+/, '')}`;
  const text = encodeURIComponent(message);
  return `https://wa.me/${num}?text=${text}`;
}

// ─── إرسال للمجموعة + رابط واتساب جاهز ──────────────
async function notifyGroup(groupText, phone, waMessage) {
  if (!ENV.GROUP_ID) return;
  const link = waLink(phone, waMessage);
  await send(ENV.GROUP_ID, groupText, {
    reply_markup: {
      inline_keyboard: [[{
        text: '📱 افتح واتساب وأرسل',
        url: link,
      }]],
    },
  });
}

// ─── Session ─────────────────────────────────────────
async function getSession(chatId) {
  const rows = await sb('GET', `jc_sessions?chat_id=eq.${chatId}`);
  return rows[0] ?? { chat_id: chatId, state: 'idle', data: {} };
}

async function setSession(chatId, state, data) {
  await sb('POST', 'jc_sessions', {
    chat_id: chatId,
    state,
    data,
    updated_at: new Date().toISOString(),
  });
}

async function clearSession(chatId) {
  await setSession(chatId, 'idle', {});
}

// ─── Card Number ──────────────────────────────────────
async function nextCardNo(type = 'repair') {
  const rows   = await sb('GET', 'job_cards?select=id&order=id.desc&limit=1');
  const seq    = rows.length ? rows[0].id + 1 : 1;
  const yy     = new Date().getFullYear().toString().slice(2);
  const prefix = type === 'scan' ? 'FC' : 'JC';
  return `${prefix}${yy}-${String(seq).padStart(4, '0')}`;
}

// ─── Close Menu ───────────────────────────────────────
async function sendCloseMenu(chatId, card) {
  const cust = card.jc_customers;
  const car  = card.jc_cars;
  return send(chatId,
    `🔒 إغلاق <b>${card.card_number}</b>\n` +
    `👤 ${cust?.name ?? '—'} | 📱 ${cust?.phone ?? '—'}\n` +
    `🚗 ${car?.brand ?? ''} ${car?.model ?? ''} — ${car?.plate ?? ''}\n\nنوع الإغلاق؟`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ إغلاق عادي', callback_data: `close:${card.id}:norm` }],
          [{ text: '⭐ إغلاق + طلب تقييم', callback_data: `close:${card.id}:rev` }],
        ],
      },
    }
  );
}

// ════════════════════════════════════════
//  فحص كمبيوتر
// ════════════════════════════════════════
async function createScanCard(chatId, d) {
  try {
    let customerId = d.customer_id ?? null;

    if (!customerId) {
      const found = await sb('GET', `jc_customers?phone=eq.${d.phone}`);
      if (found.length) {
        customerId = found[0].id;
        if (d.name && found[0].name === 'عميل فحص') {
          await sbPatch(`jc_customers?id=eq.${customerId}`, { name: d.name });
        }
      } else {
        const [c] = await sb('POST', 'jc_customers', {
          name:  d.name || 'عميل فحص',
          phone: d.phone,
        });
        customerId = c.id;
      }
    }

    const cardNo = await nextCardNo('scan');
    const now    = new Date().toISOString();

    await sb('POST', 'job_cards', {
      card_number:   cardNo,
      customer_id:   customerId,
      car_id:        null,
      problem_notes: d.plate ? `فحص كمبيوتر · ${d.plate}` : 'فحص كمبيوتر',
      card_type:     'scan',
      status:        'closed',
      opened_at:     now,
      closed_at:     now,
    });

    const display = (d.name && d.name !== 'عميل فحص') ? d.name : 'عزيزنا';
    const plateInfo = d.plate ? ` — ${d.plate}` : '';

    // رسالة الواتساب الجاهزة
    const waMsg =
      `مرحبا ${display} 👋\n\n` +
      `تم استلام سيارتك${plateInfo} في كراج البحر للفحص 🔍\n` +
      `سنرسل لك تقرير الفحص خلال لحظات 📋\n\n` +
      `كراج البحر 💙`;

    // إشعار المجموعة
    await notifyGroup(
      `🔍 <b>فحص كمبيوتر — ${cardNo}</b>\n` +
      `📱 ${d.phone}${d.name && d.name !== 'عميل فحص' ? ` · ${d.name}` : ''}\n` +
      `${d.plate ? `🔢 ${d.plate}\n` : ''}` +
      `\nاضغط الزر لفتح الواتساب وأرسل رسالة الاستقبال 👇`,
      d.phone,
      waMsg
    );

    await clearSession(chatId);

    // رد على الفني
    return send(chatId,
      `✅ <b>فحص كمبيوتر — ${cardNo}</b>\n` +
      `📱 ${d.phone}${d.name && d.name !== 'عميل فحص' ? ` · ${d.name}` : ''}\n` +
      `${d.plate ? `🔢 ${d.plate}\n` : ''}` +
      `\n📩 تم إرسال الرسالة للمجموعة — كمبيوتر الورشة يرسلها للعميل`
    );
  } catch (e) {
    await clearSession(chatId);
    return send(chatId, `❌ خطأ: ${e.message}`);
  }
}

// ════════════════════════════════════════
//  إصلاح / صيانة
// ════════════════════════════════════════
async function createCard(chatId, d) {
  try {
    let customerId = d.customer_id;
    let carId      = d.car_id;

    if (!customerId) {
      const [c] = await sb('POST', 'jc_customers', {
        name:  d.customer_name,
        phone: d.customer_phone,
      });
      customerId = c.id;
    }

    if (!carId) {
      const [car] = await sb('POST', 'jc_cars', {
        customer_id: customerId,
        brand:       d.car_brand ?? '',
        model:       d.car_model ?? '',
        plate:       d.car_plate ?? '',
      });
      carId = car.id;
    }

    const cardNo  = await nextCardNo('repair');
    const carInfo = `${d.car_brand ?? ''} ${d.car_model ?? ''} — ${d.car_plate ?? ''}`.trim();

    await sb('POST', 'job_cards', {
      card_number:   cardNo,
      customer_id:   customerId,
      car_id:        carId,
      problem_notes: d.problem_notes ?? '',
      card_type:     'repair',
      status:        'open',
      opened_at:     new Date().toISOString(),
    });

    // رسالة الاستقبال الجاهزة
    const waMsg =
      `مرحبا ${d.customer_name} 👋\n\n` +
      `وصلت سيارتك ${carInfo} لكراج البحر 🔧\n` +
      `رقم كرت العمل: ${cardNo}\n\n` +
      `سنعلمك فور ما تخلص إن شاء الله 💙\n` +
      `كراج البحر`;

    // إشعار المجموعة
    await notifyGroup(
      `🔧 <b>كرت جديد — ${cardNo}</b>\n` +
      `👤 ${d.customer_name}\n` +
      `🚗 ${carInfo}\n` +
      `📱 ${d.customer_phone}\n` +
      `${d.problem_notes ? `📝 ${d.problem_notes}\n` : ''}` +
      `\nاضغط الزر لإرسال رسالة الاستقبال 👇`,
      d.customer_phone,
      waMsg
    );

    await clearSession(chatId);
    return send(chatId,
      `✅ <b>تم فتح الكرت — ${cardNo}</b>\n\n` +
      `👤 ${d.customer_name}\n` +
      `🚗 ${carInfo}\n\n` +
      `📩 تم إرسال الرسالة للمجموعة`
    );
  } catch (e) {
    await clearSession(chatId);
    return send(chatId, `❌ خطأ: ${e.message}`);
  }
}

// ─── إغلاق كرت إصلاح ─────────────────────────────────
async function closeCard(chatId, cardId, type) {
  const rows = await sb('GET',
    `job_cards?id=eq.${cardId}&select=*,jc_customers(name,phone),jc_cars(brand,model,plate)`
  );
  const card = rows[0];
  if (!card) return send(chatId, '❌ ما لقيت الكرت');

  await sbPatch(`job_cards?id=eq.${cardId}`, {
    status:    'closed',
    closed_at: new Date().toISOString(),
  });

  const cust    = card.jc_customers;
  const car     = card.jc_cars;
  const carInfo = `${car?.brand ?? ''} ${car?.model ?? ''} — ${car?.plate ?? ''}`.trim();

  // رسالة "السيارة جاهزة"
  let waMsg =
    `مرحبا ${cust?.name ?? ''} 🎉\n\n` +
    `سيارتك ${carInfo} جاهزة للاستلام ✅\n\n`;

  if (type === 'rev') {
    waMsg +=
      `لو ما تقصّر، نتشرف بتقييمك ⭐⭐⭐⭐⭐\n` +
      `يساعدنا نوصل لناس أكثر 🙏\n` +
      `${ENV.REVIEW_LINK}\n\n`;
  }

  waMsg += `نتشرف بخدمتك دايماً 💙\nكراج البحر`;

  // إشعار المجموعة
  await notifyGroup(
    `🔒 <b>تم إغلاق ${card.card_number}</b>\n` +
    `👤 ${cust?.name ?? '—'}\n` +
    `🚗 ${carInfo}\n\n` +
    `اضغط الزر لإرسال رسالة${type === 'rev' ? ' + طلب تقييم ⭐' : ' الجاهزية'} 👇`,
    cust?.phone ?? '',
    waMsg
  );

  return send(chatId,
    `🔒 <b>تم إغلاق ${card.card_number}</b>\n` +
    `📩 تم إرسال الرسالة للمجموعة`
  );
}

// ════════════════════════════════════════
//  Main Handler
// ════════════════════════════════════════
async function handle(update) {
  const msg    = update.message ?? update.callback_query?.message;
  const cq     = update.callback_query;
  const chatId = msg?.chat?.id;
  if (!chatId) return;

  const text   = update.message?.text?.trim() ?? '';
  const cqData = cq?.data ?? '';

  if (cq) await tg('answerCallbackQuery', { callback_query_id: cq.id });

  const sess = await getSession(chatId);
  const d    = sess.data;

  // ── أوامر عامة ─────────────────────────────────────
  if (text === '/start' || text === '/help') {
    return send(chatId,
      `🔧 <b>بوت كروت البحر</b>\n` +
      `كراج البحر — اختر من القائمة 👇`,
      {
        reply_markup: {
          keyboard: [
            [{ text: '📝 فتح كرت جديد' }, { text: '📋 الكروت المفتوحة' }],
            [{ text: '🔒 إغلاق كرت' },    { text: '❌ إلغاء' }],
          ],
          resize_keyboard:   true,
          persistent:        true,
          input_field_placeholder: 'اختر من القائمة أو اكتب...',
        },
      }
    );
  }

  // ── ربط أزرار الكيبورد بالأوامر ──────────────────────
  if (text === '📝 فتح كرت جديد')    return handle({ ...update, message: { ...update.message, text: '/فتح' } });
  if (text === '📋 الكروت المفتوحة') return handle({ ...update, message: { ...update.message, text: '/كروت' } });
  if (text === '🔒 إغلاق كرت')       return handle({ ...update, message: { ...update.message, text: '/اغلاق' } });
  if (text === '❌ إلغاء')            return handle({ ...update, message: { ...update.message, text: '/الغاء' } });

  if (text === '/الغاء') {
    await clearSession(chatId);
    return send(chatId, '✅ تم الإلغاء');
  }

  // ── /كروت ──────────────────────────────────────────
  if (text === '/كروت') {
    const cards = await sb('GET',
      'job_cards?status=eq.open&order=opened_at.asc' +
      '&select=*,jc_customers(name,phone),jc_cars(brand,model,plate)'
    );
    if (!cards.length) return send(chatId, '📋 ما في كروت مفتوحة الحين');

    let out = `📋 <b>كروت الإصلاح المفتوحة — ${cards.length}</b>\n\n`;
    for (const c of cards) {
      const t = new Date(c.opened_at).toLocaleString('ar-SA', {
        timeZone: 'Asia/Riyadh', dateStyle: 'short', timeStyle: 'short',
      });
      out +=
        `🔴 <b>${c.card_number}</b>\n` +
        `👤 ${c.jc_customers?.name ?? '—'} | 📱 ${c.jc_customers?.phone ?? '—'}\n` +
        `🚗 ${c.jc_cars?.brand ?? ''} ${c.jc_cars?.model ?? ''} — ${c.jc_cars?.plate ?? ''}\n` +
        `📝 ${c.problem_notes || 'بدون ملاحظات'}\n` +
        `⏰ ${t}\n\n`;
    }
    return send(chatId, out);
  }

  // ── /اغلاق ─────────────────────────────────────────
  if (text.startsWith('/اغلاق')) {
    const cardNo = text.split(' ')[1];
    if (!cardNo) {
      const cards = await sb('GET',
        'job_cards?status=eq.open&order=opened_at.asc' +
        '&select=*,jc_customers(name),jc_cars(plate)'
      );
      if (!cards.length) return send(chatId, '📋 ما في كروت مفتوحة');
      const kb = cards.map(c => [{
        text: `${c.card_number} — ${c.jc_customers?.name ?? '?'} (${c.jc_cars?.plate ?? '?'})`,
        callback_data: `pick:${c.id}`,
      }]);
      return send(chatId, 'اختر الكرت:', { reply_markup: { inline_keyboard: kb } });
    }
    const rows = await sb('GET',
      `job_cards?card_number=eq.${cardNo}` +
      `&select=*,jc_customers(name,phone),jc_cars(brand,model,plate)`
    );
    if (!rows.length) return send(chatId, '❌ ما لقيت الكرت');
    return sendCloseMenu(chatId, rows[0]);
  }

  if (cqData.startsWith('pick:')) {
    const id   = cqData.split(':')[1];
    const rows = await sb('GET',
      `job_cards?id=eq.${id}&select=*,jc_customers(name,phone),jc_cars(brand,model,plate)`
    );
    if (!rows.length) return send(chatId, '❌ ما لقيت الكرت');
    return sendCloseMenu(chatId, rows[0]);
  }

  if (cqData.startsWith('close:')) {
    const [, cardId, type] = cqData.split(':');
    return closeCard(chatId, cardId, type);
  }

  // ── /فتح ───────────────────────────────────────────
  if (text === '/فتح') {
    await setSession(chatId, 's_service', {});
    return send(chatId, '📋 <b>كرت جديد</b>\n\nنوع الخدمة؟', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔍 فحص كمبيوتر', callback_data: 'svc:scan' }],
          [{ text: '🔧 إصلاح / صيانة', callback_data: 'svc:repair' }],
        ],
      },
    });
  }

  // ── Flow فحص كمبيوتر ───────────────────────────────
  if (cqData === 'svc:scan') {
    await setSession(chatId, 's_scan_ph', {});
    return send(chatId, '🔍 <b>فحص كمبيوتر</b>\n\n📱 رقم جوال العميل:');
  }

  if (sess.state === 's_scan_ph') {
    const phone    = text.trim();
    const existing = await sb('GET', `jc_customers?phone=eq.${phone}&select=*,jc_cars(*)`);
    if (existing.length) {
      const cust  = existing[0];
      const cars  = cust.jc_cars ?? [];
      const plate = cars.length ? cars[0].plate : '';
      const carLbl = cars.length
        ? `🚗 ${cars[0].brand} ${cars[0].model} — ${cars[0].plate}`.trim()
        : '';
      await setSession(chatId, 's_scan_ok', { phone, name: cust.name, customer_id: cust.id, plate });
      return send(chatId,
        `✅ عميل معروف: <b>${cust.name}</b>\n${carLbl}\n\nتأكيد الفحص؟`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ تأكيد وفتح الفحص', callback_data: 'scan_confirm' }],
              [{ text: '✏️ تعديل الاسم/اللوحة', callback_data: 'scan_edit' }],
              [{ text: '❌ إلغاء', callback_data: 'cancel' }],
            ],
          },
        }
      );
    }
    await setSession(chatId, 's_scan_name', { phone });
    return send(chatId, `📱 ${phone}\n\n👤 اسم العميل (اختياري — اكتب "تخطي"):`);
  }

  if (sess.state === 's_scan_name') {
    const name = text === 'تخطي' ? '' : text;
    await setSession(chatId, 's_scan_plate', { ...d, name });
    return send(chatId, '🔢 رقم اللوحة (اختياري — اكتب "تخطي"):');
  }

  if (sess.state === 's_scan_plate') {
    const plate = text === 'تخطي' ? '' : text;
    const nd    = { ...d, plate };
    await setSession(chatId, 's_scan_ok', nd);
    return send(chatId,
      `📋 <b>ملخص الفحص</b>\n─────────────────────\n` +
      `📱 ${nd.phone}\n👤 ${nd.name || '—'}\n🔢 ${nd.plate || '—'}\n\nتأكيد؟`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ تأكيد وفتح الفحص', callback_data: 'scan_confirm' }],
            [{ text: '❌ إلغاء', callback_data: 'cancel' }],
          ],
        },
      }
    );
  }

  if (cqData === 'scan_edit') {
    await setSession(chatId, 's_scan_name', { phone: d.phone });
    return send(chatId, '👤 اسم العميل (اختياري — اكتب "تخطي"):');
  }

  if (cqData === 'scan_confirm' && sess.state === 's_scan_ok') {
    return createScanCard(chatId, d);
  }

  // ── Flow إصلاح / صيانة ─────────────────────────────
  if (cqData === 'svc:repair') {
    await setSession(chatId, 's_type', {});
    return send(chatId, '🔧 <b>إصلاح / صيانة</b>\n\nنوع العميل؟', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '👤 عميل جديد', callback_data: 'type:new' }],
          [{ text: '🔄 عميل سابق', callback_data: 'type:ret' }],
        ],
      },
    });
  }

  if (cqData === 'type:new') {
    await setSession(chatId, 's_name', {});
    return send(chatId, '👤 اكتب اسم العميل:');
  }

  if (cqData === 'type:ret') {
    await setSession(chatId, 's_search', {});
    return send(chatId, '📱 أرسل رقم الجوال أو رقم اللوحة:');
  }

  if (sess.state === 's_search') {
    const q  = text;
    let rows = await sb('GET', `jc_customers?phone=eq.${q}&select=*,jc_cars(*)`);
    if (!rows.length) {
      const cars = await sb('GET', `jc_cars?plate=ilike.${q}&select=*,jc_customers(*)`);
      if (cars.length) rows = [{ ...cars[0].jc_customers, jc_cars: [cars[0]] }];
    }
    if (!rows.length) {
      await clearSession(chatId);
      return send(chatId, '❌ ما لقيت عميل. جرب /فتح وسجله جديد');
    }
    const cust = rows[0];
    const cars = cust.jc_cars ?? [];
    if (!cars.length) {
      await setSession(chatId, 's_brand', {
        customer_id: cust.id, customer_name: cust.name, customer_phone: cust.phone,
      });
      return send(chatId, `✅ <b>${cust.name}</b>\nما عنده سيارة مسجلة\n\n🚗 نوع السيارة:`);
    }
    if (cars.length === 1) {
      const car = cars[0];
      await setSession(chatId, 's_prob', {
        customer_id: cust.id, customer_name: cust.name, customer_phone: cust.phone,
        car_id: car.id, car_brand: car.brand, car_model: car.model, car_plate: car.plate,
      });
      return send(chatId,
        `✅ <b>${cust.name}</b>\n🚗 ${car.brand} ${car.model} — ${car.plate}\n\n📝 وصف المشكلة (أو "تخطي"):`
      );
    }
    await setSession(chatId, 's_pickcar', {
      customer_id: cust.id, customer_name: cust.name, customer_phone: cust.phone,
    });
    const kb = cars.map(car => [{
      text: `${car.brand} ${car.model} — ${car.plate}`,
      callback_data: `car:${car.id}`,
    }]);
    return send(chatId, `✅ <b>${cust.name}</b> — اختر السيارة:`, {
      reply_markup: { inline_keyboard: kb },
    });
  }

  if (cqData.startsWith('car:') && sess.state === 's_pickcar') {
    const carId   = cqData.split(':')[1];
    const carRows = await sb('GET', `jc_cars?id=eq.${carId}`);
    if (!carRows.length) return send(chatId, '❌ خطأ، جرب مرة ثانية');
    const car = carRows[0];
    await setSession(chatId, 's_prob', {
      ...d,
      car_id: car.id, car_brand: car.brand, car_model: car.model, car_plate: car.plate,
    });
    return send(chatId,
      `🚗 <b>${car.brand} ${car.model} — ${car.plate}</b>\n\n📝 وصف المشكلة (أو "تخطي"):`
    );
  }

  if (sess.state === 's_name') {
    await setSession(chatId, 's_phone', { customer_name: text });
    return send(chatId, '📱 رقم الجوال:');
  }

  if (sess.state === 's_phone') {
    await setSession(chatId, 's_brand', { ...d, customer_phone: text });
    return send(chatId, '🚗 نوع السيارة (اكتب مثلاً: تو):');
  }

  if (sess.state === 's_brand') {
    const matches = CAR_BRANDS.filter(b => b.includes(text));
    if (!matches.length) {
      await setSession(chatId, 's_model', { ...d, car_brand: text });
      return send(chatId, `✅ ${text}\n\nالموديل / السنة:`);
    }
    if (matches.length === 1) {
      await setSession(chatId, 's_model', { ...d, car_brand: matches[0] });
      return send(chatId, `✅ ${matches[0]}\n\nالموديل / السنة:`);
    }
    const kb = matches.slice(0, 6).map(b => [{ text: b, callback_data: `brand:${b}` }]);
    return send(chatId, '🚗 اختر الماركة:', { reply_markup: { inline_keyboard: kb } });
  }

  if (cqData.startsWith('brand:')) {
    const brand = cqData.replace('brand:', '');
    await setSession(chatId, 's_model', { ...d, car_brand: brand });
    return send(chatId, `✅ ${brand}\n\nالموديل / السنة:`);
  }

  if (sess.state === 's_model') {
    await setSession(chatId, 's_plate', { ...d, car_model: text });
    return send(chatId, '🔢 رقم اللوحة:');
  }

  if (sess.state === 's_plate') {
    await setSession(chatId, 's_prob', { ...d, car_plate: text });
    return send(chatId, '📝 وصف المشكلة (أو "تخطي"):');
  }

  if (sess.state === 's_prob') {
    const notes = text === 'تخطي' ? '' : text;
    const nd    = { ...d, problem_notes: notes };
    await setSession(chatId, 's_confirm', nd);
    return send(chatId,
      `📋 <b>ملخص الكرت</b>\n─────────────────────\n` +
      `👤 ${nd.customer_name}\n📱 ${nd.customer_phone ?? '—'}\n` +
      `🚗 ${nd.car_brand ?? ''} ${nd.car_model ?? ''}\n` +
      `🔢 ${nd.car_plate ?? '—'}\n📝 ${notes || 'بدون ملاحظات'}\n\nتأكيد؟`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ فتح الكرت', callback_data: 'confirm' }],
            [{ text: '❌ إلغاء', callback_data: 'cancel' }],
          ],
        },
      }
    );
  }

  if (cqData === 'cancel') {
    await clearSession(chatId);
    return send(chatId, '❌ تم الإلغاء');
  }

  if (cqData === 'confirm' && sess.state === 's_confirm') {
    return createCard(chatId, d);
  }
}

// ─── Entry Point ──────────────────────────────────────
export default {
  async fetch(request, env) {
    ENV = env;
    if (request.method === 'POST') {
      const update = await request.json();
      await handle(update);
    }
    return new Response('ok');
  },
};
