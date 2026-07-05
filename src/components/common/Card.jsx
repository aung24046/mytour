export default function Card({ children, className = '', ...props }) {
  return (
    <div
      className={`rounded-card border border-white/60 bg-surface p-4 shadow-card ring-1 ring-black/[0.02] ${className}`}
      {...props}
    >
      {children}
    </div>
  )
}
