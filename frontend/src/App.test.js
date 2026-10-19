import { render, screen } from '@testing-library/react'
import App from './App'

describe('Jomla.ma Frontend Smoke Tests', () => {
  test('renders Jomla.ma brand title and hero elements', () => {
    render(<App />)
    const brandElements = screen.getAllByText(/Jomla\.ma/i)
    expect(brandElements.length).toBeGreaterThanOrEqual(1)

    const heroTitle = screen.getByText(/قلب على أي منتج بالجملة/i)
    expect(heroTitle).toBeInTheDocument()
  })

  test('renders supplier and admin action buttons', () => {
    render(<App />)
    expect(screen.getByText(/دخول المورد/i)).toBeInTheDocument()
    expect(screen.getByText(/سجل كمورد/i)).toBeInTheDocument()
    const adminButtons = screen.getAllByText(/الإشراف|لوحة المشرف/i)
    expect(adminButtons.length).toBeGreaterThanOrEqual(1)
  })
})

