import { createContext, useContext, useState, useEffect } from 'react'
import { translations } from './translations'
import englishLabels from './englishLabels.json'

const LanguageContext = createContext()

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(() => {
    try {
      const saved = localStorage.getItem('jomla_lang')
      return ['ar', 'fr', 'en'].includes(saved) ? saved : 'ar'
    } catch {
      return 'ar'
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem('jomla_lang', lang)
    } catch {
      // ignore
    }
    // Update document direction and lang attribute
    document.documentElement.lang = lang
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
  }, [lang])

  const toggleLang = () => {
    setLang(prev => (prev === 'ar' ? 'fr' : 'ar'))
  }

  const t = (key) => {
    if (lang === 'en') return translations.en?.[key] || englishLabels[translations.fr?.[key]] || key
    return translations[lang]?.[key] || translations['ar']?.[key] || key
  }

  return (
    <LanguageContext.Provider value={{ lang, setLang: value => setLang(['ar', 'fr', 'en'].includes(value) ? value : 'ar'), toggleLang, t, isRtl: lang === 'ar' }}>
      <div dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        {children}
      </div>
    </LanguageContext.Provider>
  )
}

export const useTranslation = () => {
  const context = useContext(LanguageContext)
  if (!context) {
    // Fallback if rendered outside LanguageProvider
    return {
      lang: 'ar',
      setLang: () => {},
      toggleLang: () => {},
      t: (key) => translations['ar']?.[key] || key,
      isRtl: true
    }
  }
  return context
}

export default LanguageContext
