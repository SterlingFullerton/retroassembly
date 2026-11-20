import { Select } from '@radix-ui/themes'
import { useTranslation } from 'react-i18next'
import { shaders } from '#@/consoles/shaders.ts'

interface ShaderSelectProps extends Select.RootProps {
  /** The shader highlighted in the open list, and undefined once the list closes */
  onHighlight?: (shader: string | undefined) => void
}

export function ShaderSelect({ onHighlight, onOpenChange, ...props }: Readonly<ShaderSelectProps>) {
  const { t } = useTranslation()

  function handleOpenChange(open: boolean) {
    if (!open) {
      onHighlight?.(undefined)
    }
    onOpenChange?.(open)
  }

  return (
    <Select.Root {...props} onOpenChange={handleOpenChange}>
      <Select.Trigger />
      <Select.Content>
        {shaders.map((shader) => (
          <Select.Item key={shader.id} onFocus={() => onHighlight?.(shader.id)} value={shader.id || 'none'}>
            <div className='flex items-center gap-2'>
              <span className={shader.id ? 'icon-[mdi--stars]' : 'icon-[mdi--do-not-disturb-alt]'} />
              <span>{shader.id ? shader.name : t('common.disabledLower')}</span>
            </div>
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  )
}
