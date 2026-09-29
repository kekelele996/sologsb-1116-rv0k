/** 孢子印印色枚举 */
export const SPORE_COLORS = ['白色', '奶油色', '淡黄', '粉褐', '紫褐', '黑褐'] as const
export type SporeColor = (typeof SPORE_COLORS)[number]

/** SporePrint 孢子印（每次观察独立一条，按登记先后留档） */
export interface SporePrint {
  id: string
  recordId: string
  color: SporeColor
  /** 印形 */
  shape: string
  /** 获取时长（小时） */
  hours: number
  observeDate: string
  /** 样本干湿度说明 */
  moisture: string
  /** 登记时刻（ISO 字符串），用于按登记先后排序，图谱与候选只取最近一次 */
  createdAt: string
}
