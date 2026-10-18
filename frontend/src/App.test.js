import { render, screen } from '@testing-library/react'
import App from './App'

describe('Jomla.ma Frontend Smoke Tests', () => {
  test('renders Jomla.ma brand title and hero elements', () => {
    render(<App />)
    const brandElement = screen.getByText(/Jomla\.ma/i)
    expect(brandElement).toBeInTheDocument()

    const heroTitle = screen.getByText(/قلب على أي منتج بالجملة/i)
    expect(heroTitle).toBeInTheDocument()
  })

  test('renders supplier action buttons', () => {
    render(<App />)
    expect(screen.getByText(/دخول المورد/i)).toBeInTheDocument()
    expect(screen.getByText(/سجل كمورد/i)).toBeInTheDocument()
  })
})
