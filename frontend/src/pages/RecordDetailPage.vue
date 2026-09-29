<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
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
import { compareByRegisteredDesc, latestSporeOf, sporeColorHex, sporeTextColor } from '@/utils/spore'
import { uid } from '@/utils/id'

const route = useRoute()
const router = useRouter()
const recordState = useStore(recordStore)
const sporeState = useStore(sporeStore)
const pointState = useStore(pointStore)
const identifyState = useStore(identifyStore)

const record = computed(() => recordState.records.find((item) => item.id === route.params.id) ?? null)
const logs = computed(() => identifyState.logs.filter((item) => item.recordId === record.value?.id))
/** 历次观察按登记先后留档，详情时间线按时间顺序展开（旧 → 新） */
const sporeHistory = computed<SporePrint[]>(() =>
  sporeState.spores
    .filter((item) => item.recordId === record.value?.id)
    .sort((a, b) => -compareByRegisteredDesc(a, b))
)
/** 图谱色块与候选排序只看最近一次；最近一条被移除后自动回到上一条，全部清空才为 null（未记录） */
const latestSpore = computed<SporePrint | null>(() =>
  record.value ? latestSporeOf(sporeState.spores, record.value.id) : null
)
/** 当前条目所属采集点名称（在脚本内取，避免模板内箭头函数丢失空值收窄） */
const recordPointName = computed(() => {
  const current = record.value
  if (!current) return '未关联'
  return pointState.points.find((item) => item.id === current.pointId)?.name ?? '未关联'
})

interface SporeFormState {
  color: SporeColor
  shape: string
  hours: number
  observeDate: string
  moisture: string
}

/** 新一次观察的空白表单（观察日期默认今天） */
function createSporeForm(): SporeFormState {
  return {
    color: '白色',
    shape: '',
    hours: 12,
    observeDate: new Date().toISOString().slice(0, 10),
    moisture: ''
  }
}

const sporeForm = reactive<SporeFormState>(createSporeForm())

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
  () => [record.value?.id, pointState.points.length] as const,
  () => {
    if (!record.value) return
    // 切到另一条目时表单回到空白，避免把上一条条目的观察误存进来
    Object.assign(sporeForm, createSporeForm())
    const point = pointState.points.find((item) => item.id === record.value?.pointId)
    if (point) Object.assign(pointDraft, point)
  },
  { immediate: true }
)

async function saveSpore(): Promise<void> {
  const current = record.value
  if (!current) return
  const sameDay = sporeHistory.value.filter((item) => item.observeDate === sporeForm.observeDate)
  let mode: 'replace' | 'supplement' = 'supplement'
  if (sameDay.length > 0) {
    // 同一天已有结果：确认 = 替换当天记录；取消 = 作为补充另存；关闭弹窗 = 放弃本次保存
    try {
      await ElMessageBox.confirm(
        `${sporeForm.observeDate} 已有 ${sameDay.length} 条孢子印观察结果。要替换当天记录，还是作为补充另存？`,
        '当天已有观察结果',
        {
          confirmButtonText: '替换当天记录',
          cancelButtonText: '作为补充另存',
          distinguishCancelAndClose: true,
          type: 'warning'
        }
      )
      mode = 'replace'
    } catch (action) {
      if (action === 'close') return
      mode = 'supplement'
    }
  }

  const row: SporePrint = {
    id: uid('spo'),
    recordId: current.id,
    color: sporeForm.color,
    shape: sporeForm.shape.trim(),
    hours: Number(sporeForm.hours) || 0,
    observeDate: sporeForm.observeDate,
    moisture: sporeForm.moisture.trim(),
    createdAt: new Date().toISOString()
  }
  const state = sporeStore.getState()
  if (mode === 'replace') {
    await state.removeMany(sameDay.map((item) => item.id))
  }
  await state.save(row)
  Object.assign(sporeForm, createSporeForm())
  ElMessage.success(
    mode === 'replace'
      ? `已替换 ${row.observeDate} 的孢子印记录：${row.color}`
      : `孢子印观察已留档（第 ${sporeHistory.value.length} 次）：${row.color}`
  )
}

async function removeSporeObservation(item: SporePrint): Promise<void> {
  await sporeStore.getState().remove(item.id)
  ElMessage.success('该次孢子印观察已移除')
}

async function savePoint(): Promise<void> {
  if (!pointDraft.name.trim()) {
    ElMessage.warning('采集点名称不能为空')
    return
  }
  await pointStore.getState().save({ ...pointDraft })
  ElMessage.success('采集点信息已更新')
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
        <TraitsSummary :record="record" :spore="latestSpore" :default-open="['cap', 'flesh', 'gill', 'stipe', 'eco']" />
        <p v-if="record.note" class="note">现场备注：{{ record.note }}</p>
      </el-card>

      <el-card shadow="never" class="block">
        <template #header>
          <div class="block-head">
            <span>孢子印观察（{{ sporeHistory.length }} 次留档）</span>
            <SporePrintSwatch
              :color="latestSpore?.color ?? null"
              size="large"
              :caption="
                latestSpore
                  ? `最近一次 ${latestSpore.observeDate} · 获取 ${latestSpore.hours} h`
                  : '尚未记录'
              "
            />
          </div>
        </template>
        <div class="spore-body">
          <div class="spore-history">
            <el-empty v-if="sporeHistory.length === 0" description="该条目尚未登记孢子印观察" :image-size="72" />
            <el-timeline v-else class="spore-timeline">
              <el-timeline-item
                v-for="item in sporeHistory"
                :key="item.id"
                :timestamp="`观察日期 ${item.observeDate}`"
                placement="top"
                :type="item.id === latestSpore?.id ? 'primary' : 'info'"
                :hollow="item.id !== latestSpore?.id"
              >
                <div class="spore-card" :class="{ latest: item.id === latestSpore?.id }">
                  <div class="spore-card-head">
                    <span
                      class="spore-color-chip"
                      :style="{ background: sporeColorHex(item.color), color: sporeTextColor(item.color) }"
                    >
                      {{ item.color }}
                    </span>
                    <el-tag v-if="item.id === latestSpore?.id" type="primary" size="small" effect="dark">最近一次</el-tag>
                    <el-button class="spore-remove" link type="danger" size="small" @click="removeSporeObservation(item)">
                      移除
                    </el-button>
                  </div>
                  <p class="spore-meta">印形：{{ item.shape || '—' }}</p>
                  <p class="spore-meta">时长：{{ item.hours }} 小时 · 样本干湿度：{{ item.moisture || '—' }}</p>
                </div>
              </el-timeline-item>
            </el-timeline>
            <p v-if="sporeHistory.length > 0" class="spore-hint">
              历次观察按登记先后留档；移除最近一条后自动回退到上一条，图谱色块与鉴定候选排序始终只采用最近一次。
            </p>
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
              <el-button type="primary" @click="saveSpore">登记本次观察</el-button>
            </div>
            <p class="spore-form-tip">样本干湿不同可隔天重做；同一天已有结果时，可选择替换当天记录或作为补充另存。</p>
          </el-form>
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
  gap: 20px;
  align-items: flex-start;
}
.spore-history {
  flex: 1 1 340px;
  min-width: 0;
}
.spore-timeline {
  padding: 8px 4px 0 8px;
}
.spore-card {
  padding: 8px 12px;
  border: 1px solid #e8e2d6;
  border-left: 4px solid #cfc7ba;
  border-radius: 8px;
  background: #fff;
}
.spore-card.latest {
  border-color: #c96f3a;
  border-left-color: #c96f3a;
  background: #fdf7f0;
}
.spore-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.spore-color-chip {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid rgba(31, 45, 36, 0.18);
  font-size: 12px;
  font-weight: 600;
}
.spore-remove {
  margin-left: auto;
}
.spore-meta {
  margin: 2px 0;
  font-size: 12px;
  color: #4b5b50;
}
.spore-hint {
  margin: 10px 0 0;
  font-size: 12px;
  color: #7f8d82;
  line-height: 1.6;
}
.spore-form {
  flex: 1 1 300px;
}
.spore-form-tip {
  margin: 6px 0 0;
  padding-left: 0;
  font-size: 12px;
  color: #9a9186;
  line-height: 1.6;
}
.form-actions {
  display: flex;
  gap: 8px;
  padding-left: 92px;
}
</style>
