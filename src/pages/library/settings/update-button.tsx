import { Button, type ButtonProps } from '@radix-ui/themes'
import { clsx } from 'clsx'
import type { PreferenceSnippet } from '#@/constants/preference.ts'
import { usePreference } from '#@/pages/library/hooks/use-preference.ts'

interface ResetButtonProps extends ButtonProps {
  preference: PreferenceSnippet
}

export function UpdateButton({ preference, ...props }: Readonly<ResetButtonProps>) {
  const { isLoading, update } = usePreference()

  async function handleClickReset() {
    await update(preference)
  }
  return (
    <Button
      type='button'
      {...props}
      className={clsx('h-auto! min-h-8 py-1.5! text-center whitespace-normal!', props.className)}
      disabled={isLoading}
      onClick={handleClickReset}
      size='2'
      variant='soft'
    >
      {props.children}
    </Button>
  )
}
