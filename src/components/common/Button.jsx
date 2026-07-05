export default function Button({
  children,
  variant = 'primary',
  className = '',
  disabled = false,
  fullWidth = true,
  ...props
}) {
  // แก้บั๊ก "ปุ่มใหญ่มาก ช่องกรอกเล็กมาก" — เดิม base มี w-full ฝังตายตัว เวลาบางหน้าอยากได้ปุ่ม
  // ขนาดพอดีคำ (เช่น ปุ่มค้นหา/สร้าง Tag ที่วางคู่กับ input ใน flex row) ต้องส่ง className="w-auto"
  // มาทับ แต่ Tailwind ไม่การันตีว่า class ที่มาทีหลังใน string จะชนะ class ที่ชนกันใน base (ลำดับ
  // ชนะขึ้นกับลำดับใน stylesheet ที่ Tailwind สร้าง ไม่ใช่ลำดับใน className) ทำให้ w-full ใน base
  // ชนะแบบสุ่ม ปุ่มเลยกางเต็มพื้นที่ที่เหลือใน flex จนดันช่อง input ข้างๆ ให้เล็กแทบไม่เห็น
  // แก้ด้วยการควบคุมผ่าน prop fullWidth แทนแทนที่จะพึ่ง className override
  const base =
    `inline-flex ${fullWidth ? 'w-full' : 'w-auto'} items-center justify-center gap-2 rounded-control px-4 py-3 text-base font-semibold transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 disabled:shadow-none focus-visible:outline-none`

  const variants = {
    primary:
      'bg-brand-gradient text-white shadow-brand hover:brightness-105 hover:shadow-lg',
    secondary:
      'bg-white text-brand ring-1 ring-inset ring-brand-light hover:bg-brand-lighter',
    accent:
      'bg-accent text-white shadow-accent hover:bg-accent-hover',
    danger:
      'bg-danger text-white shadow-sm hover:bg-red-700',
    ghost:
      'bg-transparent text-ink-muted hover:bg-neutral-bg',
  }

  return (
    <button
      className={`${base} ${variants[variant] ?? variants.primary} ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  )
}
