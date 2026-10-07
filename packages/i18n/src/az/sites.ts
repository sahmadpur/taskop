export default {
  title: 'Obyektlər',
  types: {
    title: 'Obyekt növləri',
    add: 'Növ əlavə et',
    name: 'Növün adı',
    order: 'Sıra',
  },
  tree: {
    title: 'Obyekt strukturu',
    addRoot: 'Əsas obyekt əlavə et',
    addChild: 'Alt obyekt',
    move: 'Köçür',
    moveTitle: '«{{name}}» obyektini köçür',
    moveTarget: 'Yeni yer',
    root: '— Ən üst səviyyə —',
    empty: 'Hələ obyekt yoxdur.',
    expand: 'Aç',
    collapse: 'Bağla',
  },
  form: {
    createTitle: 'Yeni obyekt',
    editTitle: 'Obyekti redaktə et',
    name: 'Ad',
    type: 'Növ',
    address: 'Ünvan',
    parent: 'Yuxarı obyekt: {{name}}',
  },
} as const;
