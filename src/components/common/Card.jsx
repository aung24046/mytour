export default function Card({ children, className = '', ...props }) {
  return (
    <div className={`rounded-2xl bg-white p-4 shadow-sm ${className}`} {...props}>
      {children}
    </div>
  )
}
