<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { CollectPoint, SporeColor, SporePrint } from '@/types'
import { SPORE_COLORS } from '@/types'
import GeoPointForm from '@/components/common/GeoPointForm.vue'
import GillAttachmentTag from '@/components/common/GillAttachmentTag.vue'
import SporePrintSwatch from '@/components/common/SporePrintSwatch.vue'
import TraitsSummary from '@/components/common/TraitsSummary.vue'
import { useStore } from '@/hooks/usePersistentStore'
import { recordStore } from '@/stores/recordStore'
import { sporeStore } from '@/stores/sporeStore'
import { pointStore } from '@/stores/pointStore'
import { identifyStore } from '@/stores/identifyStore'
import { sortSporesByRegistration, sporeColorHex, sporeTextColor } from '@/utils/spore'
import { uid } from '@/utils/id'

const route = useRoute()
const router = useRouter()
const recordState = useStore(recordStore)
const sporeState = useStore(sporeStore)
const pointState = useStore(pointStore)
const identifyState = useStore(identifyStore)

const record = computed(() => recordState.records.find((item) => item.id === route.params.id) ?? null)
/** 孢子印明细按登记先后从早到晚展开 */
const sporeHistory = computed<SporePrint[]>(() =>
  sortSporesByRegistration(sporeState.spores.filter((item) => item.recordId === record.value?.id))
)
/** 图谱、形态摘要与候选排序只看最近一次登记 */
const spore = computed<SporePrint | null>(() => sporeHistory.value[sporeHistory.value.length - 1] ?? null)
const logs = computed(() => identifyState.logs.filter((item) => item.recordId === record.value?.id))
/** 当前条目所属采集点名称（在脚本内取，避免模板内箭头函数丢失空值收窄） */
const recordPointName = computed(() => {
  const current = record.value
  if (!current) return '未关联'
  return pointState.points.find((item) => item.id === current.pointId)?.name ?? '未关联'
})

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

const sporeForm = reactive({
  id: '',
  color: '白色' as SporeColor,
  shape: '',
  hours: 12,
  observeDate: today(),
  moisture: ''
})
const creatingSpore = ref(false)

const pointDraft = reactive<CollectPoint>({
  id: '',
  name: '',
  longitude: 0,
  latitude: 0,
  altitude: 0,
  vegetation: '针阔混交林',
  substrate: '落叶层',
  companionTrees: '',
  collectDate: '',
  collector: ''
})

watch(
  () =>
    [
      record.value?.id,
      sporeForm.id,
      sporeHistory.value.map((item) => item.id).join('|'),
      pointState.points.length
    ] as const,
  () => {
    if (!record.value) return
    if (!creatingSpore.value) {
      const editing = sporeState.spores.find((item) => item.id === sporeForm.id)
      const current = editing ?? spore.value
      if (current) fillSporeForm(current)
    }
    const point = pointState.points.find((item) => item.id === record.value?.pointId)
    if (point) Object.assign(pointDraft, point)
  },
  { immediate: true }
)

function resetSporeForm(): void {
  sporeForm.id = ''
  sporeForm.color = '白色'
  sporeForm.shape = ''
  sporeForm.hours = 12
  sporeForm.observeDate = today()
  sporeForm.moisture = ''
}

function fillSporeForm(current: SporePrint): void {
  sporeForm.id = current.id
  sporeForm.color = current.color
  sporeForm.shape = current.shape
  sporeForm.hours = current.hours
  sporeForm.observeDate = current.observeDate
  sporeForm.moisture = current.moisture
}

function startNewSpore(): void {
  creatingSpore.value = true
  resetSporeForm()
}

function cancelNewSpore(): void {
  creatingSpore.value = false
  if (spore.value) fillSporeForm(spore.value)
  else resetSporeForm()
}

function editSpore(current: SporePrint): void {
  creatingSpore.value = false
  fillSporeForm(current)
}

function registrationTime(createdAt: number): string {
  return new Date(createdAt).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

async function saveSpore(): Promise<void> {
  if (!record.value) return

  let targetId = sporeForm.id
  let replacedSameDay = false

  // 新登记遇到同一天已有结果时，由队员决定替换当天记录，还是作为补充另存。
  if (!targetId) {
    const sameDay = [...sporeHistory.value].reverse().find((item) => item.observeDate === sporeForm.observeDate)
    if (sameDay) {
      try {
        await ElMessageBox.confirm(
          `观察日期 ${sameDay.observeDate} 已有「${sameDay.color}」记录。替换当天记录，还是把本次观察作为补充另存？`,
          '当天已有孢子印观察',
          {
            confirmButtonText: '替换当天记录',
            cancelButtonText: '作为补充另存',
            distinguishCancelAndClose: true,
            type: 'warning'
          }
        )
        targetId = sameDay.id
        replacedSameDay = true
      } catch (action) {
        if (action === 'close') return
      }
    }
  }

  const existing = targetId ? sporeState.spores.find((item) => item.id === targetId) : undefined
  const row: SporePrint = {
    id: targetId || uid('spo'),
    recordId: record.value.id,
    color: sporeForm.color,
    shape: sporeForm.shape.trim(),
    hours: Number(sporeForm.hours) || 0,
    observeDate: sporeForm.observeDate,
    moisture: sporeForm.moisture.trim(),
    // 替换当天记录时保留原登记顺位；补充另存才写入新的登记时间。
    createdAt: existing?.createdAt ?? Date.now()
  }
  await sporeStore.getState().save(row)
  creatingSpore.value = false
  sporeForm.id = row.id
  ElMessage.success(
    replacedSameDay ? `已替换 ${row.observeDate} 的孢子印记录：${row.color}` : `孢子印观察已留档：${row.color}`
  )
}

async function savePoint(): Promise<void> {
  if (!pointDraft.name.trim()) {
    ElMessage.warning('采集点名称不能为空')
    return
  }
  await pointStore.getState().save({ ...pointDraft })
  ElMessage.success('采集点信息已更新')
}

async function removeSpore(id = sporeForm.id): Promise<void> {
  if (!id) return
  const target = sporeState.spores.find((item) => item.id === id)
  await ElMessageBox.confirm(
    `确认删除 ${target?.observeDate ?? ''} 的「${target?.color ?? '孢子印'}」观察记录？`,
    '删除确认',
    { type: 'warning' }
  )
  await sporeStore.getState().remove(id)
  if (sporeForm.id === id) {
    creatingSpore.value = false
    resetSporeForm()
  }
  ElMessage.success('孢子印记录已删除')
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div v-if="record">
        <h2 class="page-title">{{ record.tempName || '未命名条目' }}</h2>
        <p class="page-sub">
          <span class="mono">{{ record.code }}</span> · 采集点
          {{ recordPointName }} · 采集日期
          {{ record.collectDate }} · 采集人 {{ record.collector || '—' }}
        </p>
      </div>
      <div v-else>
        <h2 class="page-title">条目详情</h2>
        <p class="page-sub">未找到该条目，可能已被删除。</p>
      </div>
      <div class="head-actions">
        <el-button @click="router.push('/atlas')">返回图谱</el-button>
        <el-button v-if="record" @click="router.push('/identify')">去鉴定</el-button>
      </div>
    </div>

    <template v-if="record">
      <el-card shadow="never" class="block">
        <template #header>
          <div class="block-head">
            <span>形态描述</span>
            <GillAttachmentTag :attachment="record.attachment" with-hint />
          </div>
        </template>
        <TraitsSummary :record="record" :spore="spore" :default-open="['cap', 'flesh', 'gill', 'stipe', 'eco']" />
        <p v-if="record.note" class="note">现场备注：{{ record.note }}</p>
      </el-card>

      <el-card shadow="never" class="block">
        <template #header>
          <div class="block-head">
            <span>孢子印观察（{{ sporeHistory.length }} 次留档）</span>
            <SporePrintSwatch
              :color="spore?.color ?? null"
              size="large"
              :caption="spore ? `最近一次 · 获取 ${spore.hours} h` : '尚未记录'"
            />
          </div>
        </template>
        <div class="spore-body">
          <div class="spore-current" :style="{ background: spore ? sporeColorHex(spore.color) : '#f2f4f6' }">
            <div v-if="spore" class="spore-info">
              <p class="spore-caption">最近一次登记</p>
              <p class="spore-color">{{ spore.color }}</p>
              <p class="spore-meta">观察日期：{{ spore.observeDate }}</p>
              <p class="spore-meta">印形：{{ spore.shape || '—' }}</p>
              <p class="spore-meta">时长：{{ spore.hours }} 小时</p>
              <p class="spore-meta">样本干湿度：{{ spore.moisture || '—' }}</p>
              <p class="spore-meta">登记时间：{{ registrationTime(spore.createdAt) }}</p>
            </div>
            <p v-else class="spore-empty">该条目尚未登记孢子印观察</p>
          </div>
          <el-form label-width="92px" class="spore-form">
            <el-form-item label="印色">
              <el-select v-model="sporeForm.color" style="width: 100%">
                <el-option v-for="color in SPORE_COLORS" :key="color" :label="color" :value="color" />
              </el-select>
            </el-form-item>
            <el-form-item label="印形">
              <el-input v-model="sporeForm.shape" placeholder="如 圆形印痕，边缘略散" />
            </el-form-item>
            <el-form-item label="时长(h)">
              <el-input-number v-model="sporeForm.hours" :min="0" :step="1" :controls="false" style="width: 100%" />
            </el-form-item>
            <el-form-item label="观察日期">
              <el-date-picker v-model="sporeForm.observeDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
            </el-form-item>
            <el-form-item label="干湿度">
              <el-input v-model="sporeForm.moisture" type="textarea" :rows="2" placeholder="如 子实体偏干，印痕较薄" />
            </el-form-item>
            <div class="form-actions">
              <el-button type="primary" @click="saveSpore">
                {{ sporeForm.id && !creatingSpore ? '保存修改' : '登记孢子印' }}
              </el-button>
              <el-button @click="creatingSpore ? cancelNewSpore() : startNewSpore()">
                {{ creatingSpore ? '取消新登记' : '另登记一次' }}
              </el-button>
              <el-button v-if="sporeForm.id && !creatingSpore" type="danger" plain @click="removeSpore()">删除记录</el-button>
            </div>
          </el-form>
        </div>

        <div class="spore-archive">
          <h4>观察留档明细</h4>
          <el-empty v-if="sporeHistory.length === 0" description="未记录：清空全部观察后才会显示此状态" />
          <ol v-else class="spore-timeline">
            <li
              v-for="(item, index) in sporeHistory"
              :key="item.id"
              class="timeline-item"
              :class="{ latest: item.id === spore?.id, editing: item.id === sporeForm.id && !creatingSpore }"
            >
              <div class="timeline-index">{{ index + 1 }}</div>
              <div class="timeline-card">
                <div class="timeline-head">
                  <div>
                    <span class="timeline-date">{{ item.observeDate }}</span>
                    <el-tag
                      size="small"
                      effect="dark"
                      :style="{
                        background: sporeColorHex(item.color),
                        borderColor: sporeColorHex(item.color),
                        color: sporeTextColor(item.color)
                      }"
                    >
                      {{ item.color }}
                    </el-tag>
                    <el-tag v-if="item.id === spore?.id" type="success" size="small" effect="plain">最近一次</el-tag>
                    <el-tag v-if="item.id === sporeForm.id && !creatingSpore" type="warning" size="small" effect="plain">编辑中</el-tag>
                  </div>
                  <span class="timeline-time">登记于 {{ registrationTime(item.createdAt) }}</span>
                </div>
                <div class="timeline-grid">
                  <span>印形：{{ item.shape || '—' }}</span>
                  <span>时长：{{ item.hours }} 小时</span>
                  <span>样本干湿度：{{ item.moisture || '—' }}</span>
                </div>
                <div class="timeline-actions">
                  <el-button size="small" link type="primary" @click="editSpore(item)">查看 / 修改</el-button>
                  <el-button size="small" link type="danger" @click="removeSpore(item.id)">移除</el-button>
                </div>
              </div>
            </li>
          </ol>
        </div>
      </el-card>

      <el-card shadow="never" class="block">
        <template #header>采集点信息（含经纬度校验）</template>
        <GeoPointForm v-model="pointDraft" with-meta />
        <div class="form-actions">
          <el-button type="primary" @click="savePoint">保存采集点</el-button>
        </div>
      </el-card>

      <el-card shadow="never" class="block">
        <template #header>鉴定留痕（{{ logs.length }} 条）</template>
        <el-table :data="logs" border stripe>
          <el-table-column prop="date" label="日期" width="120" />
          <el-table-column prop="conclusion" label="结论学名" min-width="160" />
          <el-table-column prop="basis" label="依据" width="110" />
          <el-table-column label="参考图鉴" min-width="180">
            <template #default="{ row }: { row: { referenceBook: string; referencePage: string } }">
              {{ row.referenceBook || '—' }} {{ row.referencePage }}
            </template>
          </el-table-column>
          <el-table-column prop="confidence" label="置信度" width="90" />
          <el-table-column label="复核" width="110">
            <template #default="{ row }: { row: { needReview: boolean; reviewer: string } }">
              <el-tag v-if="row.needReview" type="warning" size="small" effect="dark">待复核</el-tag>
              <span v-else class="muted">{{ row.reviewer || '已复核' }}</span>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="logs.length === 0" description="尚无鉴定结论，去「鉴定工作页」生成" />
      </el-card>
    </template>
  </div>
</template>

<style scoped>
.head-actions {
  display: flex;
  gap: 8px;
}
.block {
  border-radius: 12px;
  margin-bottom: 16px;
}
.block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.note {
  margin: 10px 0 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: #f7f5f0;
  font-size: 12px;
  color: #6f7d72;
}
.spore-body {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}
.spore-current {
  flex: 1 1 260px;
  min-height: 220px;
  border-radius: 12px;
  border: 1px solid #e8e2d6;
  padding: 16px;
  display: flex;
  align-items: center;
}
.spore-info p {
  margin: 2px 0;
}
.spore-caption {
  font-size: 12px;
  color: #6f7d72;
}
.spore-color {
  font-size: 20px;
  font-weight: 700;
}
.spore-meta {
  font-size: 12px;
  color: #4b5b50;
}
.spore-empty {
  font-size: 13px;
  color: #7f8d82;
}
.spore-form {
  flex: 1 1 320px;
}
.form-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-left: 92px;
}
.spore-archive {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px dashed #d9e0d8;
}
.spore-archive h4 {
  margin: 0 0 12px;
  font-size: 14px;
  color: #2b3a2f;
}
.spore-timeline {
  list-style: none;
  margin: 0;
  padding: 0 0 0 8px;
}
.timeline-item {
  position: relative;
  display: flex;
  gap: 12px;
  padding-bottom: 14px;
}
.timeline-item:not(:last-child)::before {
  content: '';
  position: absolute;
  left: 13px;
  top: 30px;
  bottom: 0;
  width: 1px;
  background: #d8e0d6;
}
.timeline-index {
  z-index: 1;
  flex: 0 0 28px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #eef3ea;
  color: #58705d;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
}
.timeline-item.latest .timeline-index {
  background: #2f7a4d;
  color: #fff;
}
.timeline-card {
  flex: 1;
  border: 1px solid #e5e8e1;
  border-radius: 10px;
  padding: 10px 12px;
  background: #fff;
}
.timeline-item.latest .timeline-card {
  border-color: #9cc7aa;
  background: #f7fcf8;
}
.timeline-item.editing .timeline-card {
  box-shadow: 0 0 0 1px #d99a44 inset;
}
.timeline-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.timeline-head > div {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.timeline-date {
  font-weight: 700;
  color: #2b3a2f;
}
.timeline-time {
  font-size: 12px;
  color: #7a8896;
}
.timeline-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 4px 12px;
  margin-top: 8px;
  font-size: 12px;
  color: #4b5b50;
}
.timeline-actions {
  margin-top: 4px;
}
</style>
