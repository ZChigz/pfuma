// The results service. Marks become term marks, grades, positions and level summaries here and nowhere else, so the report
// card, the analytics and the exports always agree. (legacy.ts holds the older ranking helpers the first results screens use.)
export * from '@/lib/results/legacy';
export * from '@/lib/results/types';
export * from '@/lib/results/term-mark';
export * from '@/lib/results/positions';
export * from '@/lib/results/grade';
export * from '@/lib/results/stats';
export * from '@/lib/results/preview';
