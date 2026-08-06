export default {
  content: ['./preview.html'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT:'#27272a', hover:'#18181b', light:'#e4e4e7', lighter:'#f4f4f5', deep:'#09090b' },
        accent: { DEFAULT:'#4f46e5', hover:'#4338ca', bg:'#eef2ff', text:'#3730a3' },
        surface: { DEFAULT:'#ffffff', muted:'#fafafa', sunken:'#f4f4f5' },
        ink: { DEFAULT:'#18181b', muted:'#52525b', faint:'#52525b' },
        success: { DEFAULT:'#15803d', bg:'#dcfce7', text:'#166534' },
        warning: { DEFAULT:'#b45309', bg:'#fef3c7', text:'#92400e' },
        danger: { DEFAULT:'#be123c', bg:'#ffe4e6', text:'#9f1239' },
        line: { DEFAULT:'#e4e4e7', strong:'#d4d4d8' },
      },
      fontFamily: { sans:['"Plus Jakarta Sans"','"Noto Sans Thai"','system-ui','sans-serif'] },
      backgroundImage: {
        'brand-gradient':'linear-gradient(180deg,#4f46e5 0%,#4f46e5 100%)',
        'app':'linear-gradient(180deg,#fafafa 0%,#f4f4f5 100%)',
        'accent-solid':'linear-gradient(180deg,#4f46e5 0%,#4f46e5 100%)',
      },
      borderRadius: { card:'0.75rem', control:'0.5rem', pill:'9999px' },
      boxShadow: { card:'none', 'card-hover':'0 1px 2px rgba(9,9,11,0.06)', brand:'none' },
    },
  },
  plugins: [],
}
