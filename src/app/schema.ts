export type Units = 'cm' | 'm' | 'mm' | 'in' | 'ft'

export interface Point { x: number; y: number }

export interface Wall {
  id: string
  a: Point
  b: Point
  thickness: number
}

export interface Plan {
  version: '1.0.0'
  meta: { name: string; createdAt: string; updatedAt: string; units: Units; gridSize: number }
  walls: Wall[]
}

export const createInitialPlan = (): Plan => ({
  version: '1.0.0',
  meta: {
    name: 'Untitled',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    units: 'cm',
    gridSize: 25,
  },
  walls: [],
})
