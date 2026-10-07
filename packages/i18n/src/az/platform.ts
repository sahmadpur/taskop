export default {
  title: 'Taskop platforması',
  login: { title: 'Platforma administratoru', email: 'E-poçt', password: 'Şifrə', submit: 'Daxil ol' },
  tenants: {
    title: 'Təşkilatlar',
    search: 'Ad və ya kod',
    name: 'Təşkilat',
    orgCode: 'Kod',
    users: 'İstifadəçilər',
    created: 'Yaradılıb',
    status: 'Status',
    active: 'Aktiv',
    suspended: 'Dayandırılıb',
    suspend: 'Dayandır',
    reactivate: 'Bərpa et',
    confirmSuspend: '«{{name}}» dayandırılsın? Bütün istifadəçilərin sessiyaları bağlanacaq.',
  },
  logout: 'Çıxış',
} as const;
