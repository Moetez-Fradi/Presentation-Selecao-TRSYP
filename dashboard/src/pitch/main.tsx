import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import './pitch.css'
import Deck from './Deck'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Deck />
  </StrictMode>,
)
