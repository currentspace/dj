import {render, screen} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {describe, expect, it, vi} from 'vitest'

import {SteerInput} from '../SteerInput'

describe('SteerInput', () => {
  it('renders four quick presets and a steer textbox', () => {
    render(<SteerInput onSteer={vi.fn()} />)
    expect(screen.getByRole('button', {name: 'More Energy'})).toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'Chill Out'})).toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'Go Retro'})).toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'Surprise Me'})).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('invokes onSteer with the preset direction when a preset is clicked', async () => {
    const user = userEvent.setup()
    const onSteer = vi.fn()
    render(<SteerInput onSteer={onSteer} />)
    await user.click(screen.getByRole('button', {name: 'More Energy'}))
    expect(onSteer).toHaveBeenCalledWith('More energy and upbeat tracks')
  })

  it('invokes onSteer with trimmed input when the form is submitted', async () => {
    const user = userEvent.setup()
    const onSteer = vi.fn()
    render(<SteerInput onSteer={onSteer} />)
    await user.type(screen.getByRole('textbox'), '  more acoustic guitar  ')
    await user.click(screen.getByRole('button', {name: 'Steer'}))
    expect(onSteer).toHaveBeenCalledWith('more acoustic guitar')
  })

  it('does not invoke onSteer for empty or whitespace-only submissions', async () => {
    const user = userEvent.setup()
    const onSteer = vi.fn()
    render(<SteerInput onSteer={onSteer} />)
    // Submit button is disabled when nothing is in the form, so use Enter on the input
    const input = screen.getByRole('textbox')
    await user.click(input)
    await user.keyboard('{Enter}')
    expect(onSteer).not.toHaveBeenCalled()
  })

  it('disables presets, input, and submit when disabled prop is set', () => {
    render(<SteerInput disabled onSteer={vi.fn()} />)
    expect(screen.getByRole('button', {name: 'More Energy'})).toBeDisabled()
    expect(screen.getByRole('textbox')).toBeDisabled()
    expect(screen.getByRole('button', {name: 'Steer'})).toBeDisabled()
  })

  it('shows "Steering..." when isLoading is true', () => {
    render(<SteerInput isLoading onSteer={vi.fn()} />)
    expect(screen.getByRole('button', {name: 'Steering...'})).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Steering...')).toBeInTheDocument()
  })

  it('does not call onSteer when a preset is clicked while disabled', async () => {
    const user = userEvent.setup()
    const onSteer = vi.fn()
    render(<SteerInput disabled onSteer={onSteer} />)
    await user.click(screen.getByRole('button', {name: 'More Energy'}))
    expect(onSteer).not.toHaveBeenCalled()
  })
})
