export default {
  content: ['./preview.html'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT:'#2c4269', hover:'#152238', light:'#dde3ee', lighter:'#f0f3f8', deep:'#0e1727' },
        accent: { DEFAULT:'#8f6d31', hover:'#7a5c26', bg:'#f6edd9', text:'#6b4f1f' },
        surface: { DEFAULT:'#ffffff', muted:'#f9fafb', sunken:'#eef1f5' },
        ink: { DEFAULT:'#101a2b', muted:'#68758c', faint:'#68758c' },
        success: { DEFAULT:'#2f7d5f', bg:'#e2ede6', text:'#1f4a38' },
        warning: { DEFAULT:'#b45309', bg:'#fef3c7', text:'#92400e' },
        danger: { DEFAULT:'#be123c', bg:'#ffe4e6', text:'#9f1239' },
        line: { DEFAULT:'#e3e6ec', strong:'#d3d8e0' },
      },
      fontFamily: { sans:['"Plus Jakarta Sans"','"Noto Sans Thai"','system-ui','sans-serif'] },
      backgroundImage: {
        'brand-gradient':'linear-gradient(180deg,#2c4269 0%,#2c4269 100%)',
        'app':'linear-gradient(180deg,#f9fafb 0%,#eef1f5 100%)',
        'accent-solid':'linear-gradient(180deg,#8f6d31 0%,#8f6d31 100%)',
      },
      borderRadius: { card:'0.75rem', control:'0.5rem', pill:'9999px' },
      boxShadow: { card:'none', 'card-hover':'0 1px 2px rgba(15,23,42,0.06)', brand:'none' },
    },
  },
  plugins: [],
}
