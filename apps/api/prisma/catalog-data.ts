// Launch catalog: repairs, maintenance, installation and building work. Reference content, not demo data:
// safe to load in every environment. Urdu/Arabic are drafts that MUST be reviewed by native
// speakers before launch (doc 22 §8.1). Prices are deliberately absent: they are a business
// decision per city and arrive through the pricing config, not through code.

type Tr = { ur: string; ar: string };
export interface CatalogIssue { code: string; en: string; tr: Tr }
export interface CatalogService { en: string; ur: string }
export interface CatalogCategory {
  name: string;          // stable key used by matching
  icon: string;          // key the app maps to an Ionicons glyph
  en: string; tr: Tr;
  description: string;
  services: CatalogService[];
  issues: CatalogIssue[];
}

const i = (code: string, en: string, ur: string, ar: string): CatalogIssue => ({ code, en, tr: { ur, ar } });

export const CATALOG: CatalogCategory[] = [
  {
    name: 'HVAC', icon: 'snow', en: 'AC & Cooling', tr: { ur: 'اے سی اور کولنگ', ar: 'التكييف والتبريد' },
    description: 'AC repair, servicing, gas refill and installation',
    services: [{ en: 'AC servicing', ur: 'اے سی سروس' }, { en: 'AC repair', ur: 'اے سی کی مرمت' }, { en: 'Gas refill', ur: 'گیس بھروانا' }],
    issues: [
      i('ac_not_cooling', 'AC not cooling', 'اے سی ٹھنڈا نہیں کر رہا', 'المكيف لا يبرد'),
      i('ac_water_leak', 'Water leaking from AC', 'اے سی سے پانی ٹپک رہا ہے', 'تسرب ماء من المكيف'),
      i('ac_noise', 'AC making noise', 'اے سی میں شور ہے', 'ضوضاء في المكيف'),
      i('ac_not_turning_on', 'AC will not turn on', 'اے سی آن نہیں ہو رہا', 'المكيف لا يعمل'),
      i('ac_service', 'Regular service', 'عام سروس', 'صيانة دورية'),
      i('ac_gas_refill', 'Gas refill', 'گیس بھروانی ہے', 'تعبئة الغاز'),
    ],
  },
  {
    name: 'PLUMBING', icon: 'water', en: 'Plumbing', tr: { ur: 'پلمبنگ', ar: 'السباكة' },
    description: 'Leaks, blocked drains, taps, toilets and geysers',
    services: [{ en: 'Tap & mixer repair', ur: 'نل اور مکسر کی مرمت' }, { en: 'Drain unblocking', ur: 'نالی کھولنا' }, { en: 'Geyser repair', ur: 'گیزر کی مرمت' }],
    issues: [
      i('leaking_tap', 'Leaking tap', 'نل ٹپک رہا ہے', 'تسريب في الصنبور'),
      i('blocked_drain', 'Blocked drain', 'نالی بند ہے', 'انسداد في المصرف'),
      i('no_water', 'No water coming', 'پانی نہیں آ رہا', 'لا يوجد ماء'),
      i('toilet_problem', 'Toilet problem', 'ٹوائلٹ کا مسئلہ', 'مشكلة في المرحاض'),
      i('geyser_problem', 'Geyser not working', 'گیزر خراب ہے', 'عطل في السخان'),
      i('pipe_burst', 'Burst pipe', 'پائپ پھٹ گیا ہے', 'انفجار أنبوب'),
    ],
  },
  {
    name: 'ELECTRICAL', icon: 'flash', en: 'Electrical', tr: { ur: 'بجلی کا کام', ar: 'الكهرباء' },
    description: 'Wiring, switches, fans, lights and power problems',
    services: [{ en: 'Wiring & fault finding', ur: 'وائرنگ اور خرابی کی تلاش' }, { en: 'Switch & socket repair', ur: 'سوئچ اور ساکٹ کی مرمت' }, { en: 'Fan & light repair', ur: 'پنکھے اور لائٹ کی مرمت' }],
    issues: [
      i('no_power', 'No power', 'بجلی نہیں ہے', 'انقطاع الكهرباء'),
      i('sparks_burning_smell', 'Sparks or burning smell', 'چنگاریاں یا جلنے کی بو', 'شرر أو رائحة حرق'),
      i('breaker_tripping', 'Breaker keeps tripping', 'بریکر بار بار ٹرپ ہو رہا ہے', 'القاطع يفصل باستمرار'),
      i('switch_socket', 'Broken switch or socket', 'سوئچ یا ساکٹ خراب ہے', 'مفتاح أو مقبس تالف'),
      i('fan_problem', 'Fan not working', 'پنکھا خراب ہے', 'عطل في المروحة'),
      i('light_problem', 'Light not working', 'لائٹ خراب ہے', 'عطل في الإضاءة'),
    ],
  },
  {
    name: 'APPLIANCE_REPAIR', icon: 'hardware-chip', en: 'Appliance repair', tr: { ur: 'گھریلو آلات کی مرمت', ar: 'إصلاح الأجهزة المنزلية' },
    description: 'Fridge, washing machine, oven and other home appliances',
    services: [{ en: 'Fridge repair', ur: 'فریج کی مرمت' }, { en: 'Washing machine repair', ur: 'واشنگ مشین کی مرمت' }, { en: 'Oven & stove repair', ur: 'اوون اور چولہے کی مرمت' }],
    issues: [
      i('fridge', 'Fridge not cooling', 'فریج ٹھنڈا نہیں کر رہا', 'الثلاجة لا تبرد'),
      i('washing_machine', 'Washing machine problem', 'واشنگ مشین کا مسئلہ', 'مشكلة في الغسالة'),
      i('microwave_oven', 'Microwave or oven', 'مائیکروویو یا اوون', 'ميكروويف أو فرن'),
      i('stove', 'Stove or cooker', 'چولہا یا کوکر', 'موقد أو طباخ'),
      i('water_dispenser', 'Water dispenser', 'واٹر ڈسپنسر', 'موزع المياه'),
      i('tv_repair', 'TV problem', 'ٹی وی کا مسئلہ', 'مشكلة في التلفاز'),
    ],
  },
  {
    name: 'CARPENTRY', icon: 'hammer', en: 'Carpentry', tr: { ur: 'بڑھئی کا کام', ar: 'النجارة' },
    description: 'Doors, wardrobes, furniture repair and woodwork',
    services: [{ en: 'Door & window repair', ur: 'دروازے اور کھڑکی کی مرمت' }, { en: 'Furniture repair', ur: 'فرنیچر کی مرمت' }, { en: 'Custom woodwork', ur: 'لکڑی کا خاص کام' }],
    issues: [
      i('door_repair', 'Door not closing properly', 'دروازہ ٹھیک بند نہیں ہو رہا', 'الباب لا يغلق جيدا'),
      i('cupboard_wardrobe', 'Cupboard or wardrobe', 'الماری یا وارڈروب', 'خزانة أو دولاب'),
      i('furniture_repair', 'Broken furniture', 'ٹوٹا ہوا فرنیچر', 'أثاث مكسور'),
      i('kitchen_cabinets', 'Kitchen cabinets', 'کچن کیبنٹ', 'خزائن المطبخ'),
      i('new_furniture', 'Make new furniture', 'نیا فرنیچر بنوانا', 'تصنيع أثاث جديد'),
      i('polish', 'Wood polish', 'لکڑی کی پالش', 'تلميع الخشب'),
    ],
  },
  {
    name: 'PAINTING', icon: 'color-palette', en: 'Painting', tr: { ur: 'رنگ و روغن', ar: 'الدهان' },
    description: 'Interior and exterior painting and wall repair',
    services: [{ en: 'Room painting', ur: 'کمرے کا رنگ' }, { en: 'Whole house painting', ur: 'پورے گھر کا رنگ' }, { en: 'Wall repair & putty', ur: 'دیوار کی مرمت اور پٹی' }],
    issues: [
      i('room_painting', 'Paint a room', 'ایک کمرہ رنگوانا', 'دهان غرفة'),
      i('whole_house', 'Paint whole house', 'پورا گھر رنگوانا', 'دهان المنزل كاملا'),
      i('wall_repair_paint', 'Wall cracks or damp', 'دیوار میں دراڑیں یا سیلن', 'شقوق أو رطوبة في الجدار'),
      i('exterior_paint', 'Outside walls', 'باہر کی دیواریں', 'الجدران الخارجية'),
    ],
  },
  {
    name: 'CLEANING', icon: 'sparkles', en: 'Cleaning', tr: { ur: 'صفائی', ar: 'التنظيف' },
    description: 'Home, kitchen, bathroom, sofa and water tank cleaning',
    services: [{ en: 'Deep home cleaning', ur: 'گھر کی مکمل صفائی' }, { en: 'Sofa & carpet cleaning', ur: 'صوفے اور قالین کی صفائی' }, { en: 'Water tank cleaning', ur: 'پانی کی ٹینکی کی صفائی' }],
    issues: [
      i('home_deep_cleaning', 'Deep clean my home', 'گھر کی مکمل صفائی', 'تنظيف عميق للمنزل'),
      i('kitchen_cleaning', 'Kitchen cleaning', 'کچن کی صفائی', 'تنظيف المطبخ'),
      i('bathroom_cleaning', 'Bathroom cleaning', 'باتھ روم کی صفائی', 'تنظيف الحمام'),
      i('sofa_carpet', 'Sofa or carpet', 'صوفہ یا قالین', 'أريكة أو سجاد'),
      i('water_tank_cleaning', 'Water tank cleaning', 'پانی کی ٹینکی کی صفائی', 'تنظيف خزان المياه'),
      i('post_construction', 'After construction', 'تعمیرات کے بعد صفائی', 'تنظيف بعد البناء'),
    ],
  },
  {
    name: 'GENERAL_HANDYMAN', icon: 'construct', en: 'Handyman', tr: { ur: 'عام مرمت', ar: 'أعمال الصيانة العامة' },
    description: 'Small repairs and odd jobs around the home',
    services: [{ en: 'General repairs', ur: 'عام مرمت' }, { en: 'Furniture assembly', ur: 'فرنیچر جوڑنا' }],
    issues: [
      i('general_repair', 'Something is broken', 'کچھ ٹوٹ گیا ہے', 'شيء ما مكسور'),
      i('shelf_hanging', 'Hang shelf or picture', 'شیلف یا تصویر لگانا', 'تركيب رف أو لوحة'),
      i('curtain_rod', 'Curtains or blinds', 'پردے یا بلائنڈز', 'ستائر أو شبابيك'),
      i('furniture_assembly', 'Assemble furniture', 'فرنیچر جوڑنا', 'تركيب أثاث'),
      i('door_window_repair', 'Door or window fix', 'دروازے یا کھڑکی کی مرمت', 'إصلاح باب أو نافذة'),
    ],
  },
  {
    name: 'LOCKSMITH', icon: 'key', en: 'Locksmith', tr: { ur: 'تالہ ساز', ar: 'الأقفال والمفاتيح' },
    description: 'Lockouts, lost keys and lock replacement',
    services: [{ en: 'Open locked door', ur: 'بند دروازہ کھولنا' }, { en: 'Lock replacement', ur: 'تالہ تبدیل کرنا' }],
    issues: [
      i('locked_out', 'Locked out', 'دروازہ بند ہو گیا ہے', 'مغلق خارج المنزل'),
      i('key_lost', 'Lost key', 'چابی گم ہو گئی', 'فقدان المفتاح'),
      i('lock_broken', 'Broken lock', 'تالہ ٹوٹ گیا', 'قفل مكسور'),
      i('new_lock', 'Fit a new lock', 'نیا تالہ لگوانا', 'تركيب قفل جديد'),
    ],
  },
  {
    name: 'INSTALLATION', icon: 'build', en: 'Installation', tr: { ur: 'تنصیب', ar: 'التركيب' },
    description: 'Fans, TVs, ACs, geysers, lights and cameras',
    services: [{ en: 'AC installation', ur: 'اے سی لگانا' }, { en: 'TV wall mounting', ur: 'ٹی وی دیوار پر لگانا' }, { en: 'Fan & light fitting', ur: 'پنکھا اور لائٹ لگانا' }],
    issues: [
      i('ac_install', 'Install an AC', 'اے سی لگوانا', 'تركيب مكيف'),
      i('tv_mounting', 'Mount a TV', 'ٹی وی دیوار پر لگانا', 'تركيب تلفاز على الحائط'),
      i('ceiling_fan_install', 'Fit a ceiling fan', 'سیلنگ فین لگوانا', 'تركيب مروحة سقف'),
      i('geyser_install', 'Install a geyser', 'گیزر لگوانا', 'تركيب سخان'),
      i('light_fixture', 'Fit lights', 'لائٹس لگوانا', 'تركيب إضاءة'),
      i('camera_install', 'Install CCTV', 'سی سی ٹی وی لگوانا', 'تركيب كاميرات مراقبة'),
    ],
  },
  {
    name: 'CONSTRUCTION', icon: 'business', en: 'New construction', tr: { ur: 'نئی تعمیر', ar: 'البناء الجديد' },
    description: 'Building a new house, room, floor or shop',
    services: [{ en: 'Grey structure', ur: 'گرے اسٹرکچر' }, { en: 'Full house construction', ur: 'مکمل مکان کی تعمیر' }],
    issues: [
      i('new_house', 'Build a new house', 'نیا گھر بنانا', 'بناء منزل جديد'),
      i('add_floor', 'Add a floor or room', 'نئی منزل یا کمرہ بنانا', 'إضافة طابق أو غرفة'),
      i('boundary_wall', 'Build a boundary wall', 'چار دیواری بنانا', 'بناء سور'),
      i('shop_office', 'Build a shop or office', 'دکان یا دفتر بنانا', 'بناء محل أو مكتب'),
    ],
  },
  {
    name: 'RENOVATION', icon: 'color-fill', en: 'Renovation', tr: { ur: 'تزئین و آرائش', ar: 'الترميم' },
    description: 'Remodelling kitchens, bathrooms and whole homes',
    services: [{ en: 'Kitchen remodel', ur: 'کچن کی تزئین' }, { en: 'Bathroom remodel', ur: 'باتھ روم کی تزئین' }],
    issues: [
      i('kitchen_remodel', 'Redo the kitchen', 'کچن دوبارہ بنانا', 'تجديد المطبخ'),
      i('bathroom_remodel', 'Redo a bathroom', 'باتھ روم دوبارہ بنانا', 'تجديد الحمام'),
      i('full_renovation', 'Renovate the whole home', 'پورے گھر کی تزئین', 'ترميم المنزل بالكامل'),
      i('demolition', 'Break down and clear', 'توڑ پھوڑ اور ملبہ ہٹانا', 'هدم وإزالة الأنقاض'),
    ],
  },
  {
    name: 'MASONRY', icon: 'cube', en: 'Mason & concrete', tr: { ur: 'مستری اور کنکریٹ', ar: 'البناء والخرسانة' },
    description: 'Brickwork, plaster, concrete and roof slabs',
    services: [{ en: 'Brickwork', ur: 'اینٹوں کی چنائی' }, { en: 'Plaster work', ur: 'پلستر کا کام' }],
    issues: [
      i('brickwork', 'Brick walls', 'اینٹوں کی دیوار', 'بناء جدران من الطوب'),
      i('plaster', 'Plaster', 'پلستر', 'أعمال اللياسة'),
      i('concrete_slab', 'Roof slab or concrete', 'چھت کا لینٹر یا کنکریٹ', 'صب سقف أو خرسانة'),
      i('seepage', 'Damp or seepage', 'سیلن یا رساؤ', 'رطوبة أو تسرب'),
    ],
  },
  {
    name: 'FLOORING', icon: 'grid', en: 'Tiles & flooring', tr: { ur: 'ٹائل اور فرش', ar: 'البلاط والأرضيات' },
    description: 'Tiles, marble, granite and wooden floors',
    services: [{ en: 'Tile fixing', ur: 'ٹائل لگانا' }, { en: 'Marble polishing', ur: 'ماربل پالش' }],
    issues: [
      i('floor_tiles', 'Lay floor tiles', 'فرش پر ٹائل لگانا', 'تبليط الأرضية'),
      i('wall_tiles', 'Lay wall tiles', 'دیوار پر ٹائل لگانا', 'تبليط الجدران'),
      i('marble_work', 'Marble or granite', 'ماربل یا گرینائٹ', 'رخام أو غرانيت'),
      i('polishing', 'Floor polishing', 'فرش کی پالش', 'تلميع الأرضية'),
    ],
  },
  {
    name: 'WELDING', icon: 'flame', en: 'Welding & steel', tr: { ur: 'ویلڈنگ اور لوہا', ar: 'اللحام والحديد' },
    description: 'Gates, grills, railings and steel structures',
    services: [{ en: 'Gate & grill work', ur: 'گیٹ اور گرل کا کام' }, { en: 'Steel structure', ur: 'لوہے کا ڈھانچہ' }],
    issues: [
      i('gate', 'Make or fix a gate', 'گیٹ بنانا یا مرمت', 'صنع أو إصلاح بوابة'),
      i('grill', 'Window grills', 'کھڑکی کی گرل', 'شبك نوافذ'),
      i('railing', 'Stair railing', 'سیڑھی کی ریلنگ', 'درابزين السلم'),
      i('shed', 'Shed or steel roof', 'شیڈ یا لوہے کی چھت', 'مظلة أو سقف حديدي'),
    ],
  },
  {
    name: 'ROOFING', icon: 'home', en: 'Roofing & waterproofing', tr: { ur: 'چھت اور واٹر پروفنگ', ar: 'الأسقف والعزل' },
    description: 'Roof leaks, waterproofing and heat proofing',
    services: [{ en: 'Waterproofing', ur: 'واٹر پروفنگ' }, { en: 'Heat proofing', ur: 'ہیٹ پروفنگ' }],
    issues: [
      i('roof_leak', 'Roof is leaking', 'چھت ٹپک رہی ہے', 'تسرب من السقف'),
      i('waterproofing', 'Waterproof the roof', 'چھت کی واٹر پروفنگ', 'عزل السقف عن الماء'),
      i('heat_proofing', 'Heat proofing', 'ہیٹ پروفنگ', 'العزل الحراري'),
      i('false_ceiling', 'False ceiling', 'فالس سیلنگ', 'سقف مستعار'),
    ],
  },
  {
    name: 'SOLAR', icon: 'sunny', en: 'Solar', tr: { ur: 'سولر', ar: 'الطاقة الشمسية' },
    description: 'Solar panels, inverters and batteries',
    services: [{ en: 'Solar installation', ur: 'سولر لگانا' }, { en: 'Panel cleaning & service', ur: 'پینل کی صفائی اور سروس' }],
    issues: [
      i('solar_install', 'Install solar panels', 'سولر پینل لگوانا', 'تركيب ألواح شمسية'),
      i('inverter_battery', 'Inverter or battery', 'انورٹر یا بیٹری', 'محول أو بطارية'),
      i('solar_service', 'Service or cleaning', 'سروس یا صفائی', 'صيانة أو تنظيف'),
      i('solar_fault', 'Solar not working', 'سولر کام نہیں کر رہا', 'النظام الشمسي لا يعمل'),
    ],
  },
  {
    name: 'INTERIOR', icon: 'easel', en: 'Interior & aluminium', tr: { ur: 'انٹیریئر اور ایلومینیم', ar: 'الديكور والألمنيوم' },
    description: 'Kitchen cabinets, windows, glass and decoration',
    services: [{ en: 'Aluminium windows', ur: 'ایلومینیم کی کھڑکیاں' }, { en: 'Interior design', ur: 'انٹیریئر ڈیزائن' }],
    issues: [
      i('cabinets', 'Kitchen cabinets or wardrobes', 'کچن کیبنٹ یا الماری', 'خزائن مطبخ أو ملابس'),
      i('aluminium_windows', 'Aluminium windows', 'ایلومینیم کی کھڑکی', 'نوافذ ألمنيوم'),
      i('glass_work', 'Glass work', 'شیشے کا کام', 'أعمال الزجاج'),
      i('design', 'Design a room', 'کمرے کا ڈیزائن', 'تصميم غرفة'),
    ],
  },
  {
    name: 'AUTOMOTIVE', icon: 'car', en: 'Car & vehicle', tr: { ur: 'گاڑی اور وہیکل', ar: 'السيارات والمركبات' },
    description: 'Mechanic, auto electrician, battery, tyres and roadside breakdown help',
    services: [{ en: 'Mechanic visit', ur: 'مکینک کی سروس' }, { en: 'Battery & auto electrical', ur: 'بیٹری اور آٹو الیکٹریکل' }, { en: 'Tyre & puncture', ur: 'ٹائر اور پنکچر' }],
    issues: [
      i('car_wont_start', 'Car will not start', 'گاڑی اسٹارٹ نہیں ہو رہی', 'السيارة لا تعمل'),
      i('roadside_breakdown', 'Broken down on the road', 'راستے میں گاڑی خراب ہو گئی', 'تعطلت السيارة على الطريق'),
      i('car_towing', 'Need a tow', 'گاڑی ٹو کرانی ہے', 'بحاجة إلى سحب السيارة'),
      i('flat_tyre', 'Flat tyre or puncture', 'ٹائر پنکچر ہے', 'إطار مثقوب'),
      i('battery_dead', 'Battery dead or weak', 'بیٹری ختم یا کمزور ہے', 'البطارية فارغة أو ضعيفة'),
      i('car_overheating', 'Engine overheating', 'انجن زیادہ گرم ہو رہا ہے', 'ارتفاع حرارة المحرك'),
      i('car_electrical', 'Lights or electrical fault', 'لائٹس یا الیکٹریکل خرابی', 'عطل في الإضاءة أو الكهرباء'),
      i('car_ac', 'Car AC not cooling', 'گاڑی کا اے سی ٹھنڈا نہیں کر رہا', 'مكيف السيارة لا يبرد'),
      i('car_service', 'General service or tuning', 'عام سروس یا ٹیوننگ', 'صيانة عامة أو ضبط'),
    ],
  },
  {
    name: 'PEST_CONTROL', icon: 'bug', en: 'Pest control', tr: { ur: 'کیڑے مار سروس', ar: 'مكافحة الحشرات' },
    description: 'Termites, cockroaches, rodents, mosquitoes and fumigation',
    services: [{ en: 'General fumigation', ur: 'عام فیومیگیشن' }, { en: 'Termite treatment', ur: 'دیمک کا علاج' }],
    issues: [
      i('cockroaches', 'Cockroaches', 'لال بیگ', 'صراصير'),
      i('termites', 'Termites', 'دیمک', 'النمل الأبيض'),
      i('rodents', 'Rats or mice', 'چوہے', 'فئران'),
      i('mosquitoes', 'Mosquitoes or flies', 'مچھر یا مکھیاں', 'بعوض أو ذباب'),
      i('bedbugs', 'Bedbugs', 'کھٹمل', 'بق الفراش'),
      i('general_fumigation', 'Full home fumigation', 'پورے گھر کی فیومیگیشن', 'تعقيم كامل للمنزل'),
    ],
  },
  {
    name: 'GARDENING', icon: 'leaf', en: 'Gardening', tr: { ur: 'باغبانی', ar: 'البستنة' },
    description: 'Lawn care, tree cutting, planting and garden clean-up',
    services: [{ en: 'Lawn mowing', ur: 'گھاس کی کٹائی' }, { en: 'Tree & hedge cutting', ur: 'درخت اور باڑ کی کٹائی' }, { en: 'Planting', ur: 'پودے لگانا' }],
    issues: [
      i('lawn_mowing', 'Mow the lawn', 'گھاس کاٹنی ہے', 'قص العشب'),
      i('tree_cutting', 'Cut or trim a tree', 'درخت کاٹنا یا تراشنا', 'قطع أو تقليم شجرة'),
      i('hedge_trimming', 'Trim hedges or plants', 'باڑ یا پودوں کی تراش', 'تقليم الأسيجة أو النباتات'),
      i('planting', 'Plant or re-pot', 'پودے لگانا یا گملے بدلنا', 'زراعة أو إعادة تأصيص'),
      i('garden_cleanup', 'Garden clean-up', 'باغ کی صفائی', 'تنظيف الحديقة'),
    ],
  },
  {
    name: 'MOVERS', icon: 'file-tray-stacked', en: 'Movers & packers', tr: { ur: 'سامان کی منتقلی', ar: 'النقل والتغليف' },
    description: 'House and office shifting, packing, loading and labour',
    services: [{ en: 'House shifting', ur: 'گھر کی منتقلی' }, { en: 'Office shifting', ur: 'دفتر کی منتقلی' }, { en: 'Labour & loading', ur: 'مزدور اور لوڈنگ' }],
    issues: [
      i('house_shifting', 'Shift my home', 'گھر شفٹ کرنا ہے', 'نقل منزلي'),
      i('office_shifting', 'Shift an office', 'دفتر شفٹ کرنا ہے', 'نقل مكتب'),
      i('single_item', 'Move a single item', 'ایک چیز منتقل کرنی ہے', 'نقل قطعة واحدة'),
      i('packing', 'Packing only', 'صرف پیکنگ', 'التغليف فقط'),
      i('loaders_only', 'Loaders / labour only', 'صرف مزدور', 'عمال فقط'),
    ],
  },
  {
    name: 'WATER_SUPPLY', icon: 'water-outline', en: 'Water supply', tr: { ur: 'پانی کی فراہمی', ar: 'إمدادات المياه' },
    description: 'Water tanker delivery, bore, and water motor or pump repair',
    services: [{ en: 'Water tanker', ur: 'پانی کا ٹینکر' }, { en: 'Motor & pump repair', ur: 'موٹر اور پمپ کی مرمت' }],
    issues: [
      i('water_tanker', 'Order a water tanker', 'پانی کا ٹینکر منگوانا', 'طلب صهريج مياه'),
      i('motor_repair', 'Water motor not working', 'واٹر موٹر خراب ہے', 'مضخة الماء لا تعمل'),
      i('suction_motor', 'Suction / booster motor', 'سکشن یا بوسٹر موٹر', 'مضخة شفط أو تقوية'),
      i('tank_overflow', 'Tank overflow or float', 'ٹینکی اوور فلو یا فلوٹ', 'طفح الخزان أو العوامة'),
      i('bore_issue', 'Boring or underground tank', 'بورنگ یا زیر زمین ٹینکی', 'حفر أو خزان أرضي'),
    ],
  },
  {
    name: 'CCTV_SECURITY', icon: 'videocam', en: 'CCTV & security', tr: { ur: 'سی سی ٹی وی اور سیکیورٹی', ar: 'كاميرات المراقبة والأمن' },
    description: 'CCTV cameras, intercoms, alarms and electric fencing',
    services: [{ en: 'CCTV installation', ur: 'سی سی ٹی وی لگانا' }, { en: 'Intercom & alarm', ur: 'انٹرکام اور الارم' }],
    issues: [
      i('cctv_install', 'Install CCTV cameras', 'سی سی ٹی وی لگوانا', 'تركيب كاميرات مراقبة'),
      i('cctv_repair', 'CCTV not working', 'سی سی ٹی وی خراب ہے', 'كاميرات المراقبة لا تعمل'),
      i('intercom', 'Intercom or video door', 'انٹرکام یا ویڈیو ڈور', 'اتصال داخلي أو باب بالفيديو'),
      i('alarm_system', 'Alarm or sensor', 'الارم یا سینسر', 'إنذار أو مستشعر'),
      i('electric_fence', 'Electric fence', 'الیکٹرک فینس', 'سياج كهربائي'),
    ],
  },
  {
    name: 'GENERATOR_UPS', icon: 'battery-charging', en: 'Generator & UPS', tr: { ur: 'جنریٹر اور یو پی ایس', ar: 'المولدات و UPS' },
    description: 'Generator, UPS and inverter service and repair',
    services: [{ en: 'Generator service', ur: 'جنریٹر سروس' }, { en: 'UPS & inverter repair', ur: 'یو پی ایس اور انورٹر کی مرمت' }],
    issues: [
      i('generator_service', 'Generator service', 'جنریٹر سروس', 'صيانة المولد'),
      i('generator_repair', 'Generator not starting', 'جنریٹر اسٹارٹ نہیں ہو رہا', 'المولد لا يعمل'),
      i('ups_repair', 'UPS or inverter fault', 'یو پی ایس یا انورٹر خرابی', 'عطل في UPS أو العاكس'),
      i('battery_replace', 'Battery replacement', 'بیٹری کی تبدیلی', 'استبدال البطارية'),
      i('auto_start', 'Auto-start or ATS', 'آٹو اسٹارٹ یا اے ٹی ایس', 'تشغيل تلقائي أو ATS'),
    ],
  },
  {
    name: 'IT_SUPPORT', icon: 'laptop', en: 'Computer & IT', tr: { ur: 'کمپیوٹر اور آئی ٹی', ar: 'الكمبيوتر وتقنية المعلومات' },
    description: 'Computer, laptop, printer, WiFi and networking help',
    services: [{ en: 'Computer & laptop repair', ur: 'کمپیوٹر اور لیپ ٹاپ کی مرمت' }, { en: 'Networking & WiFi', ur: 'نیٹ ورکنگ اور وائی فائی' }],
    issues: [
      i('computer_slow', 'Computer slow or crashing', 'کمپیوٹر سست یا بند ہو رہا ہے', 'الكمبيوتر بطيء أو يتوقف'),
      i('laptop_repair', 'Laptop repair', 'لیپ ٹاپ کی مرمت', 'إصلاح اللابتوب'),
      i('printer', 'Printer problem', 'پرنٹر کا مسئلہ', 'مشكلة في الطابعة'),
      i('wifi_network', 'WiFi or network setup', 'وائی فائی یا نیٹ ورک سیٹ اپ', 'إعداد الواي فاي أو الشبكة'),
      i('virus_data', 'Virus or data recovery', 'وائرس یا ڈیٹا ریکوری', 'فيروس أو استعادة البيانات'),
    ],
  },
  {
    name: 'GAS_SERVICES', icon: 'flame-outline', en: 'Gas services', tr: { ur: 'گیس سروس', ar: 'خدمات الغاز' },
    description: 'Gas stove, pipeline and cylinder work (non-emergency)',
    services: [{ en: 'Stove & hob repair', ur: 'چولہے اور ہاب کی مرمت' }, { en: 'Gas pipeline', ur: 'گیس پائپ لائن' }],
    issues: [
      i('stove_repair', 'Stove or hob repair', 'چولہا یا ہاب کی مرمت', 'إصلاح الموقد أو السطح'),
      i('gas_pipeline', 'Gas pipeline work', 'گیس پائپ لائن کا کام', 'أعمال خط الغاز'),
      i('cylinder_regulator', 'Cylinder or regulator', 'سلنڈر یا ریگولیٹر', 'أسطوانة أو منظم'),
      i('hob_install', 'Fit a stove or hob', 'چولہا یا ہاب لگوانا', 'تركيب موقد أو سطح'),
    ],
  },
  {
    name: 'SALON_BEAUTY', icon: 'cut', en: 'Salon & beauty', tr: { ur: 'سیلون اور بیوٹی', ar: 'الصالون والتجميل' },
    description: 'Salon, grooming and beauty services at home',
    services: [{ en: 'Ladies salon at home', ur: 'گھر پر لیڈیز سیلون' }, { en: "Men's grooming", ur: 'مردانہ گرومنگ' }],
    issues: [
      i('haircut', 'Haircut or styling', 'بال کٹوانا یا اسٹائلنگ', 'قص أو تصفيف الشعر'),
      i('facial_cleanup', 'Facial or clean-up', 'فیشل یا کلین اپ', 'تنظيف البشرة'),
      i('waxing_threading', 'Waxing or threading', 'ویکسنگ یا تھریڈنگ', 'إزالة الشعر'),
      i('mehndi', 'Mehndi / henna', 'مہندی', 'حناء'),
      i('mens_grooming', "Men's haircut or beard", 'مردانہ کٹنگ یا داڑھی', 'قص شعر الرجال أو اللحية'),
      i('bridal', 'Bridal or party makeup', 'دلہن یا پارٹی میک اپ', 'مكياج العروس أو الحفلات'),
    ],
  },
  {
    name: 'TUTORING', icon: 'school', en: 'Tutoring', tr: { ur: 'ٹیوشن', ar: 'الدروس الخصوصية' },
    description: 'Home and online tuition for school and college subjects',
    services: [{ en: 'School tuition', ur: 'اسکول ٹیوشن' }, { en: 'Test preparation', ur: 'ٹیسٹ کی تیاری' }],
    issues: [
      i('primary_tuition', 'Primary school help', 'پرائمری کلاسز', 'المرحلة الابتدائية'),
      i('matric_tuition', 'Matric / O-levels', 'میٹرک یا او لیول', 'الثانوية العامة'),
      i('college_tuition', 'College / A-levels', 'کالج یا اے لیول', 'الكلية أو الثانوية المتقدمة'),
      i('quran', 'Quran teaching', 'قرآن کی تعلیم', 'تعليم القرآن'),
      i('languages', 'Language or spoken English', 'زبان یا انگلش بولنا', 'لغات أو محادثة إنجليزية'),
    ],
  },
  {
    name: 'HEALTHCARE_AT_HOME', icon: 'medkit', en: 'Home care', tr: { ur: 'گھر پر نگہداشت', ar: 'الرعاية المنزلية' },
    description: 'Non-clinical home care: attendants, physiotherapy and injections',
    services: [{ en: 'Attendant & elderly care', ur: 'اٹینڈنٹ اور بزرگوں کی دیکھ بھال' }, { en: 'Physiotherapy', ur: 'فزیو تھراپی' }],
    issues: [
      i('elderly_care', 'Elderly or patient care', 'بزرگ یا مریض کی دیکھ بھال', 'رعاية المسنين أو المرضى'),
      i('physiotherapy', 'Physiotherapy at home', 'گھر پر فزیو تھراپی', 'علاج طبيعي منزلي'),
      i('nursing_injection', 'Nursing or injection', 'نرسنگ یا انجیکشن', 'تمريض أو حقن'),
      i('blood_sample', 'Blood sample collection', 'خون کا نمونہ لینا', 'سحب عينة دم'),
      i('baby_care', 'Baby care attendant', 'بچوں کی دیکھ بھال', 'جليسة أطفال'),
    ],
  },
];
