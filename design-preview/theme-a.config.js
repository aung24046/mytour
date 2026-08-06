export default {
  content: ['./preview.html'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT:'#2f5d8c', hover:'#1e3a5f', light:'#dbe6f1', lighter:'#eef3f9', deep:'#16304d' },
        accent: { DEFAULT:'#0f766e', hover:'#0f766e', bg:'#ccfbf1', text:'#115e59' },
        surface: { DEFAULT:'#ffffff', muted:'#f8fafc', sunken:'#f1f5f9' },
        ink: { DEFAULT:'#0f172a', muted:'#64748b', faint:'#64748b' },
        success: { DEFAULT:'#0f766e', bg:'#ccfbf1', text:'#115e59' },
        warning: { DEFAULT:'#b45309', bg:'#fef3c7', text:'#92400e' },
        danger: { DEFAULT:'#be123c', bg:'#ffe4e6', text:'#9f1239' },
        line: { DEFAULT:'#e2e8f0', strong:'#cbd5e1' },
      },
      fontFamily: { sans:['"Plus Jakarta Sans"','"Noto Sans Thai"','system-ui','sans-serif'] },
      backgroundImage: {
        'brand-gradient':'linear-gradient(180deg,#2f5d8c 0%,#2f5d8c 100%)',
        'app':'linear-gradient(180deg,#f8fafc 0%,#f1f5f9 100%)',
        'accent-solid':'linear-gradient(180deg,#0f766e 0%,#0f766e 100%)',
      },
      borderRadius: { card:'0.75rem', control:'0.5rem', pill:'9999px' },
      boxShadow: { card:'none', 'card-hover':'0 1px 2px rgba(15,23,42,0.06)', brand:'none' },
    },
  },
  plugins: [],
}
