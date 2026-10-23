import { formatMoney } from '../common/money';

// What people are told, per language. Short, plain, and never containing an exact address,
// a phone number or private message text (doc 11 "avoid sensitive information", doc 16 privacy).
// Urdu/Arabic are drafts for native-speaker review (docs/25 O13).

export type NotificationType =
  | 'job.request'
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
  | 'job.en_route'
  | 'job.arrived'
  | 'job.awaiting_confirmation'
  | 'job.confirmed'
  | 'job.auto_confirmed'
  | 'change_order.created'
  | 'change_order.approved'
  | 'change_order.declined'
  | 'payment.cash_marked'
  | 'payment.confirmed'
  | 'payment.auto_confirmed'
  | 'payment.disputed'
  | 'settlement.confirmed'
  | 'settlement.rejected'
  | 'balance.paused'
  | 'dispute.opened'
  | 'dispute.updated'
  | 'job.sos_request'
  | 'sos.searching_wider'
  | 'job.reassigned';

type Locale = 'en' | 'ur' | 'ar';
export type Money = { minor: number; currency: string };
type P = Record<string, string | number | Money | undefined>;
type T = (p: P) => { title: string; body: string };

const en: Record<NotificationType, T> = {
  'job.reassigned': (p) => ({ title: 'Finding you another professional', body: `${p.worker} can no longer do "${p.title}". We're asking others near you now.` }),
  'job.sos_request': (p) => ({ title: 'Emergency near you', body: `${p.title}${p.area ? ` · ${p.area}` : ''}${p.distance ? ` · ${p.distance} km` : ''}. Can you go now? Answer within ${p.minutes} minutes.` }),
  'sos.searching_wider': (p) => ({ title: 'Still finding help', body: `Nobody nearby could come straight away. We sent "${p.title}" to more professionals; prices will arrive shortly.` }),
  'payment.cash_marked': (p) => ({ title: 'Did you pay in cash?', body: `The professional says you paid ${p.price} for "${p.title}". Confirm, or tell us if that's wrong.` }),
  'payment.confirmed': (p) => ({ title: 'Cash payment confirmed', body: `${p.price} for "${p.title}". Fixli's fee: ${p.commission}.` }),
  'payment.auto_confirmed': (p) => ({ title: 'Cash payment confirmed', body: `${p.price} for "${p.title}" was confirmed automatically. Fixli's fee: ${p.commission}.` }),
  'payment.disputed': (p) => ({ title: 'The customer questioned a payment', body: `For "${p.title}". Fixli support will look into it; no fee is charged meanwhile.` }),
  'settlement.confirmed': (p) => ({ title: 'Payment received', body: `We received ${p.price}. Thank you!` }),
  'settlement.rejected': (p) => ({ title: "We couldn't find your payment", body: `${p.price}: ${p.reason ?? 'please check the reference and send it again.'}` }),
  'balance.paused': () => ({ title: 'New jobs paused', body: 'Please settle what you owe Fixli to get new requests again. See Earnings.' }),
  'dispute.opened': (p) => ({ title: 'A problem was reported', body: `About "${p.title}". Fixli support will contact you.` }),
  'dispute.updated': (p) => ({ title: 'Update on a reported problem', body: `About "${p.title}": ${p.status}.` }),
  'job.en_route': (p) => ({ title: `${p.worker} is on the way`, body: `For "${p.title}". You can follow them on the job screen.` }),
  'job.arrived': (p) => ({ title: `${p.worker} has arrived`, body: `For "${p.title}".` }),
  'job.awaiting_confirmation': (p) => ({ title: 'Please check the work', body: `${p.worker} finished "${p.title}". Confirm it's done, or report a problem.` }),
  'job.confirmed': (p) => ({ title: 'Job confirmed', body: `The customer confirmed "${p.title}" is done.` }),
  'job.auto_confirmed': (p) => ({ title: 'Job completed', body: `"${p.title}" was completed automatically because it wasn't confirmed in time.` }),
  'change_order.created': (p) => ({ title: 'Extra work needs your OK', body: `New total for "${p.title}": ${p.price}. Approve or decline in the app.` }),
  'change_order.approved': (p) => ({ title: 'Extra work approved', body: `New total for "${p.title}": ${p.price}.` }),
  'change_order.declined': (p) => ({ title: 'Extra work declined', body: `The customer kept the original price for "${p.title}".` }),
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
  'chat.message': (p) => ({ title: `New message from ${p.sender}`, body: 'Open Fixli to read it.' }),
};

const ur: Record<NotificationType, T> = {
  'job.reassigned': (p) => ({ title: 'آپ کے لیے دوسرا ماہر', body: `${p.worker} اب "${p.title}" نہیں کر سکتے۔ ہم قریب کے دوسرے ماہرین سے پوچھ رہے ہیں۔` }),
  'job.sos_request': (p) => ({ title: 'آپ کے قریب ایمرجنسی', body: `${p.title}${p.area ? ` · ${p.area}` : ''}${p.distance ? ` · ${p.distance} کلومیٹر` : ''}۔ کیا آپ ابھی جا سکتے ہیں؟ ${p.minutes} منٹ میں جواب دیں۔` }),
  'sos.searching_wider': (p) => ({ title: 'مدد تلاش کی جا رہی ہے', body: `قریب کوئی فوراً نہیں آ سکا۔ ہم نے "${p.title}" مزید ماہرین کو بھیج دیا ہے؛ جلد قیمتیں آئیں گی۔` }),
  'payment.cash_marked': (p) => ({ title: 'کیا آپ نے نقد ادائیگی کی؟', body: `ماہر کے مطابق آپ نے "${p.title}" کے لیے ${p.price} ادا کیے۔ تصدیق کریں یا غلط ہو تو بتائیں۔` }),
  'payment.confirmed': (p) => ({ title: 'نقد ادائیگی کی تصدیق', body: `"${p.title}" کے لیے ${p.price}۔ Fixli کی فیس: ${p.commission}۔` }),
  'payment.auto_confirmed': (p) => ({ title: 'نقد ادائیگی کی تصدیق', body: `"${p.title}" کے لیے ${p.price} کی تصدیق خود بخود ہو گئی۔ Fixli کی فیس: ${p.commission}۔` }),
  'payment.disputed': (p) => ({ title: 'گاہک نے ادائیگی پر سوال اٹھایا', body: `"${p.title}" کے لیے۔ Fixli سپورٹ دیکھے گی؛ تب تک کوئی فیس نہیں۔` }),
  'settlement.confirmed': (p) => ({ title: 'ادائیگی موصول', body: `ہمیں ${p.price} موصول ہو گئے۔ شکریہ!` }),
  'settlement.rejected': (p) => ({ title: 'آپ کی ادائیگی نہیں ملی', body: `${p.price}: ${p.reason ?? 'براہ کرم حوالہ نمبر چیک کر کے دوبارہ بھیجیں۔'}` }),
  'balance.paused': () => ({ title: 'نئے کام روک دیے گئے', body: 'نئی درخواستیں دوبارہ پانے کے لیے Fixli کی واجب الادا رقم ادا کریں۔ آمدنی دیکھیں۔' }),
  'dispute.opened': (p) => ({ title: 'ایک مسئلہ رپورٹ ہوا', body: `"${p.title}" کے بارے میں۔ Fixli سپورٹ آپ سے رابطہ کرے گی۔` }),
  'dispute.updated': (p) => ({ title: 'رپورٹ شدہ مسئلے پر اپ ڈیٹ', body: `"${p.title}": ${p.status}۔` }),
  'job.en_route': (p) => ({ title: `${p.worker} راستے میں ہیں`, body: `"${p.title}" کے لیے۔ آپ کام کی اسکرین پر انہیں دیکھ سکتے ہیں۔` }),
  'job.arrived': (p) => ({ title: `${p.worker} پہنچ گئے`, body: `"${p.title}" کے لیے۔` }),
  'job.awaiting_confirmation': (p) => ({ title: 'کام چیک کریں', body: `${p.worker} نے "${p.title}" مکمل کیا۔ تصدیق کریں یا مسئلہ بتائیں۔` }),
  'job.confirmed': (p) => ({ title: 'کام کی تصدیق ہو گئی', body: `گاہک نے "${p.title}" کی تصدیق کر دی۔` }),
  'job.auto_confirmed': (p) => ({ title: 'کام مکمل', body: `"${p.title}" وقت پر تصدیق نہ ہونے پر خود بخود مکمل ہو گیا۔` }),
  'change_order.created': (p) => ({ title: 'اضافی کام کی منظوری درکار', body: `"${p.title}" کی نئی قیمت: ${p.price}۔ ایپ میں منظور یا انکار کریں۔` }),
  'change_order.approved': (p) => ({ title: 'اضافی کام منظور', body: `"${p.title}" کی نئی قیمت: ${p.price}۔` }),
  'change_order.declined': (p) => ({ title: 'اضافی کام نامنظور', body: `گاہک نے "${p.title}" کی پرانی قیمت رکھی۔` }),
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
  'chat.message': (p) => ({ title: `${p.sender} کا نیا پیغام`, body: 'پڑھنے کے لیے Fixli کھولیں۔' }),
};

const ar: Record<NotificationType, T> = {
  'job.reassigned': (p) => ({ title: 'نبحث لك عن محترف آخر', body: `لم يعد بإمكان ${p.worker} تنفيذ "${p.title}". نسأل محترفين آخرين بالقرب منك.` }),
  'job.sos_request': (p) => ({ title: 'حالة طارئة بالقرب منك', body: `${p.title}${p.area ? ` · ${p.area}` : ''}${p.distance ? ` · ${p.distance} كم` : ''}. هل يمكنك الذهاب الآن؟ أجب خلال ${p.minutes} دقائق.` }),
  'sos.searching_wider': (p) => ({ title: 'ما زلنا نبحث عن مساعدة', body: `لم يتمكن أحد قريب من الحضور فوراً. أرسلنا "${p.title}" إلى محترفين آخرين؛ ستصل الأسعار قريباً.` }),
  'payment.cash_marked': (p) => ({ title: 'هل دفعت نقداً؟', body: `يقول المحترف إنك دفعت ${p.price} مقابل "${p.title}". أكّد أو أخبرنا إن كان ذلك خطأ.` }),
  'payment.confirmed': (p) => ({ title: 'تم تأكيد الدفع النقدي', body: `${p.price} مقابل "${p.title}". رسوم Fixli: ${p.commission}.` }),
  'payment.auto_confirmed': (p) => ({ title: 'تم تأكيد الدفع النقدي', body: `تم تأكيد ${p.price} مقابل "${p.title}" تلقائياً. رسوم Fixli: ${p.commission}.` }),
  'payment.disputed': (p) => ({ title: 'اعترض العميل على دفعة', body: `بخصوص "${p.title}". سيراجعها دعم Fixli؛ لا رسوم حتى ذلك الحين.` }),
  'settlement.confirmed': (p) => ({ title: 'تم استلام الدفعة', body: `استلمنا ${p.price}. شكراً لك!` }),
  'settlement.rejected': (p) => ({ title: 'لم نجد دفعتك', body: `${p.price}: ${p.reason ?? 'يرجى التحقق من الرقم المرجعي وإرساله مجدداً.'}` }),
  'balance.paused': () => ({ title: 'تم إيقاف الطلبات الجديدة', body: 'يرجى سداد المستحق لـ Fixli لتلقي طلبات جديدة. راجع الأرباح.' }),
  'dispute.opened': (p) => ({ title: 'تم الإبلاغ عن مشكلة', body: `بخصوص "${p.title}". سيتواصل معك دعم Fixli.` }),
  'dispute.updated': (p) => ({ title: 'تحديث بشأن مشكلة مبلّغ عنها', body: `بخصوص "${p.title}": ${p.status}.` }),
  'job.en_route': (p) => ({ title: `${p.worker} في الطريق`, body: `من أجل "${p.title}". يمكنك متابعته من شاشة الطلب.` }),
  'job.arrived': (p) => ({ title: `وصل ${p.worker}`, body: `من أجل "${p.title}".` }),
  'job.awaiting_confirmation': (p) => ({ title: 'يرجى مراجعة العمل', body: `أنهى ${p.worker} "${p.title}". أكّد الإنجاز أو أبلغ عن مشكلة.` }),
  'job.confirmed': (p) => ({ title: 'تم تأكيد العمل', body: `أكّد العميل إنجاز "${p.title}".` }),
  'job.auto_confirmed': (p) => ({ title: 'اكتمل العمل', body: `اكتمل "${p.title}" تلقائياً لعدم تأكيده في الوقت المحدد.` }),
  'change_order.created': (p) => ({ title: 'عمل إضافي يحتاج موافقتك', body: `السعر الجديد لـ "${p.title}": ${p.price}. وافق أو ارفض من التطبيق.` }),
  'change_order.approved': (p) => ({ title: 'تمت الموافقة على العمل الإضافي', body: `السعر الجديد لـ "${p.title}": ${p.price}.` }),
  'change_order.declined': (p) => ({ title: 'تم رفض العمل الإضافي', body: `أبقى العميل السعر الأصلي لـ "${p.title}".` }),
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
  'chat.message': (p) => ({ title: `رسالة جديدة من ${p.sender}`, body: 'افتح Fixli لقراءتها.' }),
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
