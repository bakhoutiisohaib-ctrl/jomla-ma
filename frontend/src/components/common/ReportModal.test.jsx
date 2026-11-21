import { render, screen, fireEvent } from '@testing-library/react'
import ReportModal from './ReportModal'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { apiRequest } from '../../api/config'

jest.mock('../../api/config', () => ({ apiRequest: jest.fn() }))
beforeEach(() => { localStorage.clear(); apiRequest.mockReset() })
const show = () => render(<LanguageProvider><ReportModal targetId="product-local" targetName="Produit test" onClose={jest.fn()} /></LanguageProvider>)

test('the French form and success feedback stay in French and remain labelled', async () => {
  localStorage.setItem('jomla_lang', 'fr')
  apiRequest.mockResolvedValue({ message: 'تم إرسال البلاغ' })
  show()
  const dialog = screen.getByRole('dialog', { name: '🚨 Signaler un produit ou fournisseur' })
  expect(dialog).toHaveStyle({ overflowY: 'auto', maxHeight: '90dvh' })
  fireEvent.change(screen.getByLabelText('Motif du signalement'), { target: { value: 'incorrect_pricing' } })
  fireEvent.change(screen.getByLabelText('Détails complémentaires'), { target: { value: 'Prix à vérifier' } })
  fireEvent.click(screen.getByRole('button', { name: 'Envoyer le signalement' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Signalement envoyé à l’administration.')
  expect(screen.getByText('Merci de contribuer à la protection du marché')).toBeInTheDocument()
  expect(apiRequest).toHaveBeenCalledWith('/reports', expect.objectContaining({ method: 'POST', token: '', body: expect.objectContaining({ targetId: 'product-local', reason: 'incorrect_pricing', details: 'Prix à vérifier' }) }))
})

test.each([
  ['ar', 'تفاصيل إضافية', 'إرسال البلاغ للإدارة', 'تعذر إرسال البلاغ'],
  ['fr', 'Détails complémentaires', 'Envoyer le signalement', 'Impossible d’envoyer le signalement']
])('a failed report keeps the entered details and presents an alert (%s)', async (lang, label, submit, error) => {
  localStorage.setItem('jomla_lang', lang)
  apiRequest.mockRejectedValue(new Error(error))
  show()
  fireEvent.change(screen.getByLabelText(label), { target: { value: 'Local test details' } })
  fireEvent.click(screen.getByRole('button', { name: submit }))
  expect(await screen.findByRole('alert')).toHaveTextContent(error)
  expect(screen.getByLabelText(label)).toHaveValue('Local test details')
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})
