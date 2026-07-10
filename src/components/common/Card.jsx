export default function Card({ children, className = '', hover = false, ...props }) {
  return (
    <div
      className={`rounded-card border border-white/60 bg-surface p-4 ring-1 ring-black/[0.02] ${hover ? 'shadow-[0_2px_0_rgba(15,43,53,0.06)] transition-all hover:-translate-y-0.5 hover:shadow-card-hover' : 'shadow-card'} ${className}`}
      {...props}
    >
      {children}
    </div>
  )
}
