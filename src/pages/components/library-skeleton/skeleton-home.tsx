const rows = [0, 1]
const covers = Array.from({ length: 12 }, (_, index) => index)

/** Home: the game being played, with its cover and buttons, then rows of covers under their headings */
export function SkeletonHome() {
  return (
    <div className='p-4 lg:mx-auto lg:max-w-[1664px] lg:p-8'>
      <div className='flex flex-col gap-4 rounded-xl bg-(--gray-a3) p-4 lg:flex-row lg:items-center lg:gap-6 lg:p-6'>
        <div className='flex items-center gap-4 lg:contents'>
          <div className='aspect-3/4 w-24 shrink-0 rounded-lg bg-(--gray-a4) motion-safe:animate-pulse lg:aspect-auto lg:h-36 lg:w-40' />
          <div className='flex min-w-0 flex-1 flex-col gap-2 lg:hidden'>
            <div className='h-3 w-24 rounded-full bg-(--gray-a4)' />
            <div className='h-6 w-40 rounded-lg bg-(--gray-a4)' />
            <div className='h-3 w-28 rounded-full bg-(--gray-a4)' />
          </div>
        </div>
        <div className='flex min-w-0 flex-col gap-3 lg:flex-1'>
          <div className='hidden flex-col gap-2 lg:flex'>
            <div className='h-3 w-28 rounded-full bg-(--gray-a4)' />
            <div className='h-8 w-72 max-w-full rounded-lg bg-(--gray-a4)' />
            <div className='h-3 w-36 rounded-full bg-(--gray-a4)' />
          </div>
          <div className='flex gap-3'>
            <div className='h-12 flex-1 rounded-lg bg-(--gray-a4) lg:w-56 lg:flex-none' />
            <div className='h-12 flex-1 rounded-lg bg-(--gray-a4) lg:w-36 lg:flex-none' />
          </div>
        </div>
      </div>

      {rows.map((row) => (
        <div className='mt-6 min-w-0 lg:mt-8' key={row}>
          <div className='mx-1 mb-5 h-7 w-36 rounded-lg bg-(--gray-a3) motion-safe:animate-pulse' />
          <div className='-mx-4 flex gap-3 overflow-hidden px-4 lg:mx-0 lg:gap-4 lg:px-0'>
            {covers.map((cover) => (
              <div className='flex w-28 shrink-0 flex-col gap-2 lg:w-36' key={cover}>
                <div className='aspect-square w-full rounded-lg bg-(--gray-a3) motion-safe:animate-pulse' />
                <div className='h-3 w-3/4 rounded-full bg-(--gray-a3) motion-safe:animate-pulse' />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
