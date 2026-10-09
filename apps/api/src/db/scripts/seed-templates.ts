import {
  blankContent,
  type ChecklistContent,
  type Item,
  newItem,
  newRule,
  newSection,
  type NumberItem,
  type ProblemSeverity,
  type SingleChoiceItem,
  type TemplateCategory,
  type YesNoItem,
} from '@taskop/contracts';

// ---- tiny DSL so fixtures stay readable ----

interface YesNoOpts {
  /** Which answer is a problem (default: 'no'). */
  bad?: 'yes' | 'no';
  severity?: ProblemSeverity;
  /** On the bad answer: require a photo, and ask for a description. */
  photo?: boolean;
  describe?: string;
  followUps?: Item[];
  required?: boolean;
}
function yesNo(label: string, o: YesNoOpts = {}): YesNoItem {
  const item = newItem('yes_no') as YesNoItem;
  item.label = label;
  item.required = o.required ?? true;
  const bad = item.options[o.bad === 'yes' ? 0 : 1];
  const rule = newRule(item);
  rule.when = { kind: 'options', optionIds: [bad.id] };
  rule.then.problem = o.severity ?? 'normal';
  rule.then.requirePhoto = o.photo ?? false;
  if (o.describe) rule.then.followUps.push(comment(o.describe));
  rule.then.followUps.push(...(o.followUps ?? []));
  item.rules.push(rule);
  return item;
}
function num(label: string, unit: string, ok: [number, number], severity: ProblemSeverity = 'normal', describe?: string): NumberItem {
  const item = newItem('number') as NumberItem;
  item.label = label;
  item.unit = unit;
  item.decimals = 1;
  const rule = newRule(item);
  rule.when = { kind: 'range', op: 'outside', min: ok[0], max: ok[1] };
  rule.then.problem = severity;
  rule.then.requireNote = true;
  if (describe) rule.then.followUps.push(comment(describe));
  item.rules.push(rule);
  return item;
}
function choice(label: string, options: string[], badIndex: number[], severity: ProblemSeverity = 'normal'): SingleChoiceItem {
  const item = newItem('single_choice') as SingleChoiceItem;
  item.label = label;
  item.options = options.map((l) => ({ id: crypto.randomUUID(), label: l }));
  const rule = newRule(item);
  rule.when = { kind: 'options', optionIds: badIndex.map((i) => item.options[i]!.id) };
  rule.then.problem = severity;
  rule.then.requirePhoto = true;
  item.rules.push(rule);
  return item;
}
function comment(label: string, required = true): Item {
  const item = newItem('comment');
  item.label = label;
  item.required = required;
  return item;
}
function text(label: string, required = true): Item {
  const item = newItem('text');
  item.label = label;
  item.required = required;
  return item;
}
function photo(label: string, min = 1): Item {
  const item = newItem('photo');
  item.label = label;
  if (item.type === 'photo') item.minCount = min;
  return item;
}
function when(label: string): Item {
  const item = newItem('datetime');
  item.label = label;
  return item;
}
function content(sections: Array<[string, Item[]]>, instructions: string | null = null): ChecklistContent {
  return { ...blankContent(), instructions, sections: sections.map(([title, items]) => ({ ...newSection(title), items })) };
}

export interface GlobalTemplateFixture {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  sortOrder: number;
  build: () => ChecklistContent;
}

export const GLOBAL_TEMPLATE_FIXTURES: GlobalTemplateFixture[] = [
  {
    id: '01920000-0000-7000-8000-000000000001',
    name: 'Gündəlik təmizlik yoxlaması',
    description: 'Ofis və ümumi sahələrin gündəlik təmizlik nəzarəti.',
    category: 'cleaning',
    sortOrder: 1,
    build: () =>
      content(
        [
          ['Giriş və dəhliz', [
            yesNo('Döşəmə təmiz və qurudur?', { photo: true, describe: 'Problemi təsvir edin' }),
            yesNo('Zibil qutuları boşaldılıb?'),
            yesNo('Giriş qapısının şüşələri təmizdir?'),
          ]],
          ['Sanitar qovşaq', [
            yesNo('Əl yuma vasitələri var?', { severity: 'critical', photo: true }),
            yesNo('Kağız dəsmal və tualet kağızı var?'),
            yesNo('Pis qoxu var?', { bad: 'yes', describe: 'Qoxunun mənbəyini qeyd edin' }),
            yesNo('Kranlar və unitazlar işlək vəziyyətdədir?', { severity: 'critical', photo: true }),
          ]],
          ['Yekun', [
            choice('Ümumi təmizlik səviyyəsi', ['Əla', 'Qənaətbəxş', 'Qeyri-qənaətbəxş'], [2]),
            photo('Ümumi görünüşün fotosu'),
            comment('Əlavə qeydlər', false),
          ]],
        ],
        'Yoxlamanı növbənin əvvəlində aparın. Problem aşkar etdikdə foto çəkin.',
      ),
  },
  {
    id: '01920000-0000-7000-8000-000000000002',
    name: 'Restoran mətbəxi — gündəlik',
    description: 'Gigiyena, temperatur və ərzaq saxlanması nəzarəti.',
    category: 'restaurant',
    sortOrder: 2,
    build: () =>
      content([
        ['Soyuducular', [
          num('Soyuducu temperaturu', '°C', [0, 5], 'critical', 'Hansı tədbir görüldü?'),
          num('Dondurucu temperaturu', '°C', [-25, -18], 'critical'),
          yesNo('Məhsullar etiketlənib və tarixi var?', { photo: true }),
          yesNo('Vaxtı keçmiş məhsul var?', { bad: 'yes', severity: 'critical', photo: true, describe: 'Məhsulları və miqdarı yazın' }),
        ]],
        ['Gigiyena', [
          yesNo('İşçilər forma və baş örtüyündədir?'),
          yesNo('Əl yuma yeri hazırdır (sabun, dəsmal)?', { severity: 'critical' }),
          yesNo('Kəsmə taxtaları rəng koduna uyğun istifadə olunur?'),
          yesNo('Həşərat izləri var?', { bad: 'yes', severity: 'critical', photo: true, describe: 'Yeri və növü' }),
        ]],
        ['Növbənin sonu', [
          yesNo('Səthlər dezinfeksiya edilib?'),
          yesNo('Qaz və elektrik avadanlıqları söndürülüb?', { severity: 'critical' }),
          when('Yoxlamanın bitmə vaxtı'),
        ]],
      ]),
  },
  {
    id: '01920000-0000-7000-8000-000000000003',
    name: 'Mağaza açılışı',
    description: 'Pərakəndə mağazanın açılışdan əvvəl hazırlığı.',
    category: 'retail',
    sortOrder: 3,
    build: () =>
      content([
        ['Satış zalı', [
          yesNo('Vitrinlər səliqəlidir?', { photo: true }),
          yesNo('Qiymət etiketləri yerindədir?', { describe: 'Etiketsiz məhsulları qeyd edin' }),
          yesNo('Rəflər doludur?'),
          choice('Zalın işıqlandırması', ['Tam işləyir', 'Qismən işləyir', 'İşləmir'], [1, 2]),
        ]],
        ['Kassa', [
          yesNo('Kassa aparatı işləyir?', { severity: 'critical' }),
          yesNo('POS terminal işləyir?', { severity: 'critical' }),
          num('Kassada nağd qalıq', 'AZN', [0, 500]),
        ]],
        ['Təhlükəsizlik', [
          yesNo('Kameralar işləyir?', { severity: 'critical', photo: true }),
          yesNo('Təcili çıxış yolu açıqdır?', { severity: 'critical', photo: true }),
          text('Açılışı edən əməkdaşın adı'),
        ]],
      ]),
  },
  {
    id: '01920000-0000-7000-8000-000000000004',
    name: 'Yanğın təhlükəsizliyi — aylıq',
    description: 'Yanğınsöndürənlər, çıxışlar və siqnalizasiya.',
    category: 'safety',
    sortOrder: 4,
    build: () =>
      content([
        ['Yanğınsöndürənlər', [
          yesNo('Bütün yanğınsöndürənlər yerindədir?', { severity: 'critical', photo: true, describe: 'Çatışmayanların yeri' }),
          yesNo('Təzyiq göstəricisi yaşıl zonadadır?', { severity: 'critical', photo: true }),
          yesNo('Yoxlama etiketi aktualdır?'),
        ]],
        ['Çıxışlar', [
          yesNo('Təcili çıxış nişanları işıqlanır?', { severity: 'critical' }),
          yesNo('Çıxış yolları maneəsizdir?', { severity: 'critical', photo: true }),
          yesNo('Evakuasiya planı asılıb?'),
        ]],
        ['Siqnalizasiya', [
          yesNo('Siqnalizasiya paneli xətasızdır?', { severity: 'critical', photo: true }),
          yesNo('Tüstü detektorları təmizdir?'),
          when('Son təlim tarixi'),
          comment('Qeydlər', false),
        ]],
      ]),
  },
  {
    id: '01920000-0000-7000-8000-000000000005',
    name: 'İstehsalat xətti — növbə başlanğıcı',
    description: 'Avadanlıq, təhlükəsizlik və keyfiyyət yoxlaması.',
    category: 'production',
    sortOrder: 5,
    build: () =>
      content([
        ['Avadanlıq', [
          yesNo('Qoruyucu örtüklər yerindədir?', { severity: 'critical', photo: true }),
          yesNo('Təcili dayandırma düyməsi işləyir?', { severity: 'critical' }),
          num('Hidravlik təzyiq', 'bar', [150, 210], 'critical', 'Texniki xidmətə məlumat verildi?'),
          yesNo('Yağ sızması var?', { bad: 'yes', photo: true, describe: 'Sızmanın yeri' }),
        ]],
        ['Fərdi mühafizə', [
          yesNo('Bütün işçilər dəbilqə və eynəkdədir?', { severity: 'critical' }),
          yesNo('Qulaqlıqlar istifadə olunur?'),
        ]],
        ['Keyfiyyət', [
          num('İlk məhsulun ölçüsü', 'mm', [49.5, 50.5], 'normal', 'Tənzimləmə edildi?'),
          photo('İlk məhsulun fotosu'),
          text('Partiya nömrəsi'),
          comment('Qeydlər', false),
        ]],
      ]),
  },
  {
    id: '01920000-0000-7000-8000-000000000006',
    name: 'Anbar — mal qəbulu',
    description: 'Daxil olan malların qəbulu və yerləşdirilməsi.',
    category: 'warehouse',
    sortOrder: 6,
    build: () =>
      content([
        ['Sənədlər', [
          text('Qaimə nömrəsi'),
          yesNo('Miqdar qaimə ilə uyğundur?', { photo: true, describe: 'Fərqi yazın' }),
          when('Qəbul vaxtı'),
        ]],
        ['Mal vəziyyəti', [
          yesNo('Qablaşdırma zədəsizdir?', { photo: true, describe: 'Zədəli yerləri təsvir edin' }),
          num('Soyuq zəncir temperaturu', '°C', [2, 8], 'critical'),
          choice('Paletlərin vəziyyəti', ['Yaxşı', 'Zədəli', 'Yararsız'], [1, 2]),
          photo('Malın ümumi fotosu', 2),
        ]],
        ['Yerləşdirmə', [
          yesNo('Mal təyin olunmuş yerə qoyulub?'),
          yesNo('Keçidlər açıqdır?', { severity: 'critical' }),
          comment('Qeydlər', false),
        ]],
      ]),
  },
  {
    id: '01920000-0000-7000-8000-000000000007',
    name: 'Keyfiyyət auditi',
    description: 'Məhsul və xidmət keyfiyyətinin seçmə yoxlanışı.',
    category: 'quality',
    sortOrder: 7,
    build: () =>
      content([
        ['Seçmə', [
          text('Yoxlanılan məhsul/xidmət'),
          num('Yoxlanılan nümunə sayı', 'əd.', [5, 1000]),
          num('Uyğunsuz nümunə sayı', 'əd.', [0, 0], 'normal', 'Uyğunsuzluğun səbəbi'),
        ]],
        ['Standartlar', [
          yesNo('Standart əməliyyat proseduru əlçatandır?'),
          yesNo('İşçilər proseduru izləyir?', { photo: true, describe: 'Pozuntunu təsvir edin' }),
          yesNo('Ölçü alətləri kalibrlənib?', { severity: 'critical' }),
          choice('Ümumi qiymətləndirmə', ['Uyğun', 'Kiçik uyğunsuzluq', 'Ciddi uyğunsuzluq'], [1, 2], 'critical'),
        ]],
        ['Nəticə', [
          photo('Sübut fotosu'),
          comment('Tövsiyələr'),
          when('Növbəti audit tarixi'),
        ]],
      ]),
  },
  {
    id: '01920000-0000-7000-8000-000000000008',
    name: 'Texniki xidmət — kondisioner',
    description: 'Kondisioner sistemlərinin dövri yoxlanışı.',
    category: 'maintenance',
    sortOrder: 8,
    build: () =>
      content([
        ['Daxili blok', [
          yesNo('Filtrlər təmizdir?', { photo: true, describe: 'Filtr dəyişdirildi?' }),
          num('Çıxan havanın temperaturu', '°C', [10, 16]),
          yesNo('Kənar səs var?', { bad: 'yes', describe: 'Səsin xarakteri' }),
          yesNo('Drenaj xəttində sızma var?', { bad: 'yes', severity: 'critical', photo: true }),
        ]],
        ['Xarici blok', [
          yesNo('Kondensator təmizdir?', { photo: true }),
          num('Freon təzyiqi', 'bar', [4, 6], 'critical', 'Hansı tədbir görüldü?'),
          yesNo('Elektrik bağlantıları qaydasındadır?', { severity: 'critical' }),
        ]],
        ['Yekun', [
          text('Avadanlığın seriya nömrəsi'),
          photo('Görülən işin fotosu'),
          comment('İstifadə olunan materiallar', false),
        ]],
      ]),
  },
];
