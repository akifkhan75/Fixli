import { formatMoney } from '../common/money';

// What people are told, per language. Short, plain, and never containing an exact address,
// a phone number or private message text (doc 11 "avoid sensitive information", doc 16 privacy).
// Urdu/Arabic are drafts for native-speaker review (docs/25 O13).

export type NotificationType =
  | 'job.request'
  | 'job.emergency_request'
  | 'job.direct_request'
  | 'offer.received'
  | 'offer.accepted'
  | 'offer.not_chosen'
  | 'job.accepted'
  | 'job.declined'
  | 'job.started'
  | 'job.completed'
  | 'job.cancelled'
  | 'job.no_one_available'
  | 'verification.approved'
  | 'verification.needs_fix'
  | 'worker.activated'
  | 'chat.message'
  | 'payment.confirm_request'
  | 'payment.confirm_reminder'
  | 'payment.auto_confirmed'
  | 'worker.commission_warning'
  | 'worker.commission_blocked';

type Locale = 'en' | 'ur' | 'ar';
export type Money = { minor: number; currency: string };
type P = Record<string, string | number | Money | undefined>;
type T = (p: P) => { title: string; body: string };

const en: Record<NotificationType, T> = {
  'job.emergency_request': (p) => ({ title: 'EMERGENCY near you', body: `${p.title}${p.area ? ` · ${p.area}` : ''}${p.distance ? ` · ${p.distance} km` : ''}. A customer needs urgent help. Send your price now.` }),
  'job.direct_request': (p) => ({ title: 'A customer asked for you', body: `"${p.title}". Accept or decline in the app.` }),
  'job.request': (p) => ({ title: 'New request near you', body: `${p.title}${p.area ? ` · ${p.area}` : ''}${p.distance ? ` · ${p.distance} km` : ''}. Send your price.` }),
  'offer.received': (p) => ({ title: 'You got a price', body: `${p.worker} can do it for ${p.price}.` }),
  'offer.accepted': (p) => ({ title: "You're booked!", body: `The customer chose your price for "${p.title}".` }),
  'offer.not_chosen': (p) => ({ title: 'Customer chose someone else', body: `"${p.title}" was booked with another professional.` }),
  'job.accepted': (p) => ({ title: `${p.worker} accepted`, body: `Your job "${p.title}" is booked.` }),
  'job.declined': (p) => ({ title: 'Professional not available', body: `${p.worker} can't take "${p.title}". We're finding someone else.` }),
  'job.started': (p) => ({ title: 'Work started', body: `${p.worker} has started on "${p.title}".` }),
  'job.completed': (p) => ({ title: 'Work finished', body: `${p.worker} marked "${p.title}" as done.` }),
  'job.cancelled': (p) => ({ title: 'Job cancelled', body: `"${p.title}" was cancelled.` }),
  'job.no_one_available': (p) => ({ title: 'Still looking', body: `No one is free for "${p.title}" right now. Your request stays open.` }),
  'verification.approved': (p) => ({ title: 'Document approved', body: `Your ${p.doc} was approved.` }),
  'verification.needs_fix': (p) => ({ title: 'Please fix a document', body: `Your ${p.doc} needs a new photo. ${p.reason ?? ''}`.trim() }),
  'worker.activated': () => ({ title: "You're approved!", body: 'Go online on the Today tab to start getting jobs.' }),
  'chat.message': (p) => ({ title: `New message from ${p.sender}`, body: `${p.text}` }),
  'payment.confirm_request': (p) => ({ title: 'Please confirm your payment', body: `${p.worker} says you paid ${p.amount} in cash for "${p.title}". Confirm or tell us if that's wrong.` }),
  'payment.confirm_reminder': (p) => ({ title: 'Reminder: confirm your payment', body: `Please confirm the ${p.amount} cash payment for "${p.title}".` }),
  'payment.auto_confirmed': (p) => ({ title: 'Payment confirmed automatically', body: `The ${p.amount} cash payment for "${p.title}" was confirmed because we didn't hear from you in 24 hours.` }),
  'worker.commission_warning': (p) => ({ title: 'Fixli fees are building up', body: `You owe ${p.owed}. Settle soon to keep receiving jobs (limit ${p.limit}).` }),
  'worker.commission_blocked': (p) => ({ title: 'You are offline until you settle', body: `You owe ${p.owed}, over the ${p.limit} limit. Settle your balance to receive new jobs. Jobs already booked are not affected.` }),
};

const ur: Record<NotificationType, T> = {
  'job.emergency_request': (p) => ({ title: 'آپ کے قریب ایمرجنسی', body: `${p.title}${p.area ? ` · ${p.area}` : ''}${p.distance ? ` · ${p.distance} کلومیٹر` : ''}۔ ایک گاہک کو فوری مدد چاہیے۔ ابھی اپنی قیمت بھیجیں۔` }),
  'job.direct_request': (p) => ({ title: 'ایک گاہک نے آپ کو بلایا ہے', body: `"${p.title}"۔ ایپ میں قبول یا انکار کریں۔` }),
  'job.request': (p) => ({ title: 'آپ کے قریب نئی درخواست', body: `${p.title}${p.area ? ` · ${p.area}` : ''}${p.distance ? ` · ${p.distance} کلومیٹر` : ''}۔ اپنی قیمت بھیجیں۔` }),
  'offer.received': (p) => ({ title: 'آپ کو قیمت ملی', body: `${p.worker} یہ کام ${p.price} میں کر سکتے ہیں۔` }),
  'offer.accepted': (p) => ({ title: 'آپ کی بکنگ ہو گئی!', body: `گاہک نے "${p.title}" کے لیے آپ کی قیمت منتخب کی۔` }),
  'offer.not_chosen': (p) => ({ title: 'گاہک نے کسی اور کو چنا', body: `"${p.title}" کسی اور ماہر کے ساتھ بک ہو گیا۔` }),
  'job.accepted': (p) => ({ title: `${p.worker} نے قبول کر لیا`, body: `آپ کا کام "${p.title}" بک ہو گیا۔` }),
  'job.declined': (p) => ({ title: 'ماہر دستیاب نہیں', body: `${p.worker} "${p.title}" نہیں لے سکتے۔ ہم کوئی اور ڈھونڈ رہے ہیں۔` }),
  'job.started': (p) => ({ title: 'کام شروع ہو گیا', body: `${p.worker} نے "${p.title}" پر کام شروع کر دیا۔` }),
  'job.completed': (p) => ({ title: 'کام مکمل', body: `${p.worker} نے "${p.title}" مکمل کر دیا۔` }),
  'job.cancelled': (p) => ({ title: 'کام منسوخ', body: `"${p.title}" منسوخ ہو گیا۔` }),
  'job.no_one_available': (p) => ({ title: 'ابھی تلاش جاری ہے', body: `"${p.title}" کے لیے ابھی کوئی فارغ نہیں۔ آپ کی درخواست کھلی ہے۔` }),
  'verification.approved': (p) => ({ title: 'دستاویز منظور', body: `آپ کی ${p.doc} منظور ہو گئی۔` }),
  'verification.needs_fix': (p) => ({ title: 'دستاویز درست کریں', body: `آپ کی ${p.doc} کی نئی تصویر درکار ہے۔ ${p.reason ?? ''}`.trim() }),
  'worker.activated': () => ({ title: 'آپ منظور ہو گئے!', body: 'کام لینے کے لیے "آج" والے حصے میں آن لائن ہو جائیں۔' }),
  'chat.message': (p) => ({ title: `${p.sender} کا نیا پیغام`, body: `${p.text}` }),
  'payment.confirm_request': (p) => ({ title: 'براہ کرم ادائیگی کی تصدیق کریں', body: `${p.worker} کے مطابق آپ نے "${p.title}" کے لیے ${p.amount} نقد ادا کیے۔ تصدیق کریں یا غلط ہو تو بتائیں۔` }),
  'payment.confirm_reminder': (p) => ({ title: 'یاد دہانی: ادائیگی کی تصدیق کریں', body: `"${p.title}" کی ${p.amount} نقد ادائیگی کی تصدیق کریں۔` }),
  'payment.auto_confirmed': (p) => ({ title: 'ادائیگی خود بخود تصدیق ہو گئی', body: `"${p.title}" کی ${p.amount} نقد ادائیگی 24 گھنٹے میں جواب نہ ملنے پر تصدیق کر دی گئی۔` }),
  'worker.commission_warning': (p) => ({ title: 'Fixli فیس بڑھ رہی ہے', body: `آپ پر ${p.owed} واجب ہیں۔ کام ملتے رہنے کے لیے جلد ادا کریں (حد ${p.limit})۔` }),
  'worker.commission_blocked': (p) => ({ title: 'ادائیگی تک آپ آف لائن ہیں', body: `آپ پر ${p.owed} واجب ہیں، حد ${p.limit} سے زیادہ۔ نئے کام کے لیے بقایا ادا کریں۔ پہلے سے بک کام متاثر نہیں ہوں گے۔` }),
};

const ar: Record<NotificationType, T> = {
  'job.emergency_request': (p) => ({ title: 'طوارئ بالقرب منك', body: `${p.title}${p.area ? ` · ${p.area}` : ''}${p.distance ? ` · ${p.distance} كم` : ''}. عميل يحتاج مساعدة عاجلة. أرسل سعرك الآن.` }),
  'job.direct_request': (p) => ({ title: 'طلبك أحد العملاء', body: `"${p.title}". اقبل أو ارفض من التطبيق.` }),
  'job.request': (p) => ({ title: 'طلب جديد بالقرب منك', body: `${p.title}${p.area ? ` · ${p.area}` : ''}${p.distance ? ` · ${p.distance} كم` : ''}. أرسل سعرك.` }),
  'offer.received': (p) => ({ title: 'وصلك سعر', body: `يمكن لـ ${p.worker} القيام بالعمل مقابل ${p.price}.` }),
  'offer.accepted': (p) => ({ title: 'تم حجزك!', body: `اختار العميل سعرك لـ "${p.title}".` }),
  'offer.not_chosen': (p) => ({ title: 'اختار العميل شخصاً آخر', body: `تم حجز "${p.title}" مع محترف آخر.` }),
  'job.accepted': (p) => ({ title: `وافق ${p.worker}`, body: `تم حجز طلبك "${p.title}".` }),
  'job.declined': (p) => ({ title: 'المحترف غير متاح', body: `لا يستطيع ${p.worker} أخذ "${p.title}". نبحث عن شخص آخر.` }),
  'job.started': (p) => ({ title: 'بدأ العمل', body: `بدأ ${p.worker} العمل على "${p.title}".` }),
  'job.completed': (p) => ({ title: 'انتهى العمل', body: `أنهى ${p.worker} "${p.title}".` }),
  'job.cancelled': (p) => ({ title: 'تم إلغاء الطلب', body: `تم إلغاء "${p.title}".` }),
  'job.no_one_available': (p) => ({ title: 'ما زلنا نبحث', body: `لا يوجد أحد متاح لـ "${p.title}" الآن. يبقى طلبك مفتوحاً.` }),
  'verification.approved': (p) => ({ title: 'تمت الموافقة على المستند', body: `تمت الموافقة على ${p.doc}.` }),
  'verification.needs_fix': (p) => ({ title: 'يرجى تصحيح مستند', body: `يحتاج ${p.doc} إلى صورة جديدة. ${p.reason ?? ''}`.trim() }),
  'worker.activated': () => ({ title: 'تمت الموافقة عليك!', body: 'كن متصلاً من تبويب "اليوم" لتبدأ باستلام الأعمال.' }),
  'chat.message': (p) => ({ title: `رسالة جديدة من ${p.sender}`, body: `${p.text}` }),
  'payment.confirm_request': (p) => ({ title: 'يرجى تأكيد الدفع', body: `يقول ${p.worker} إنك دفعت ${p.amount} نقدًا مقابل "${p.title}". أكّد أو أخبرنا إن كان ذلك خطأ.` }),
  'payment.confirm_reminder': (p) => ({ title: 'تذكير: أكّد الدفع', body: `يرجى تأكيد الدفع النقدي ${p.amount} مقابل "${p.title}".` }),
  'payment.auto_confirmed': (p) => ({ title: 'تم تأكيد الدفع تلقائيًا', body: `تم تأكيد الدفع النقدي ${p.amount} مقابل "${p.title}" لأننا لم نتلق ردًا خلال 24 ساعة.` }),
  'worker.commission_warning': (p) => ({ title: 'رسوم Fixli تتراكم', body: `عليك ${p.owed}. سدّد قريبًا لتستمر في تلقي الأعمال (الحد ${p.limit}).` }),
  'worker.commission_blocked': (p) => ({ title: 'أنت غير متصل حتى تسدد', body: `عليك ${p.owed}، وهو يتجاوز الحد ${p.limit}. سدّد رصيدك لتلقي أعمال جديدة. الأعمال المحجوزة لا تتأثر.` }),
};

const DOC: Record<Locale, Record<string, string>> = {
  en: { ID: 'ID card', SELFIE: 'selfie', TRADE_LICENSE: 'trade licence', INSURANCE: 'insurance' },
  ur: { ID: 'شناختی کارڈ', SELFIE: 'سیلفی', TRADE_LICENSE: 'لائسنس', INSURANCE: 'انشورنس' },
  ar: { ID: 'بطاقة الهوية', SELFIE: 'الصورة الشخصية', TRADE_LICENSE: 'الرخصة', INSURANCE: 'التأمين' },
};

const TEMPLATES: Record<Locale, Record<NotificationType, T>> = { en, ur, ar };

export function render(type: NotificationType, locale: string | null | undefined, params: P): { title: string; body: string } {
  const l: Locale = locale === 'ur' || locale === 'ar' ? locale : 'en';
  const p: P = { ...params, doc: params.doc ? DOC[l][String(params.doc)] ?? String(params.doc) : undefined };
  for (const [k, v] of Object.entries(p)) {
    if (v && typeof v === 'object') p[k] = formatMoney(v.minor, v.currency, l);
  }
  const out = TEMPLATES[l][type](p);
  return { title: out.title.slice(0, 120), body: out.body.slice(0, 240) };
}
