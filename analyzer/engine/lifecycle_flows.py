"""Curated cross-endpoint lifecycle views, not deployed process engine definitions."""
def lifecycle_models(beh,application_flows,objs):
 by={b['id']:b for b in beh}; app={f['trigger']['behaviorRef']:f for f in application_flows};result=[]
 def build(c,name,steps):
  # steps: (id, behaviorRef or gateway/end, next/branches)
  acts=[];objects=set();evidence=[];subflows=set()
  for aid,ref,target in steps:
   if ref in ['START','END']:
    acts.append(dict(activityId=aid,name=aid if ref=='END'else'开始',activityType=ref,nextActivities=target if isinstance(target,list)else[]));continue
   if ref=='GATEWAY':
    acts.append(dict(activityId=aid,name=aid,activityType='GATEWAY',branches=[dict(branchName=label,conditionExpression=expr,targetActivity=to,**({'isDefault':True}if expr=='DEFAULT'else{}))for label,expr,to in target],nextActivities=[]));continue
   if ref not in by:return
   b=by[ref];f=app.get(ref);objects.update(f['businessObjectRefs']if f else ([b['ownerEntity']]if b['ownerEntity']else[]));evidence+=b['evidence']
   if f:
    a=dict(activityId=aid,name=b['name'],activityType='SUB_FLOW_CALL',subFlowRef=f['id'],nextActivities=target);subflows.add(f['id'])
   else:a=dict(activityId=aid,name=b['name'],activityType='BEHAVIOR_CALL',behaviorRef=ref,nextActivities=target)
   acts.append(a)
  if not acts:return
  result.append(dict(id='FLOW-LIFECYCLE-'+c,name=name,flowType='APPROVAL'if c=='workflow'else'COLLABORATION',description='跨端点生命周期视图，串联源码中允许的状态与操作；selection/decision 表达后续操作选择，不是新增业务字段或自动执行器',context=c,businessObjectRefs=sorted(objects),roleRefs=[],trigger=dict(triggerType='MANUAL'),preconditions=['各端点沿用已有状态校验与权限边界'],postconditions=['进入源码支持的结束状态，或中止后续操作'],startActivity=acts[0]['activityId'],endActivities=[a['activityId']for a in acts if a['activityType']=='END'],activities=acts,version='1.1',modelingLevel='BUSINESS_LIFECYCLE',expressionLanguage='SEMANTIC_REVIEW',evidence=evidence,reviewRequired=True,notes='这是一份业务路径解释模型；人工任务角色尚未映射，不声明已有工作流引擎自动编排。异常分支见所调用的应用执行流程。'))
 p='payment_PaymentOrderController_'
 build('payment','支付全生命周期：受理、筛查、接受、清算与退汇',[
 ('START','START',['RECEIVE']),('RECEIVE',p+'create',['筛查结果']),('筛查结果','GATEWAY',[('筛查通过',"payment.status == 'SCREENED'",'ACCEPT'),('拒绝','DEFAULT','REJECTED')]),('ACCEPT',p+'accept',['接受后的选择']),('接受后的选择','GATEWAY',[('清算',"selection == 'SETTLE'",'SETTLE'),('直接退汇',"selection == 'RETURN'",'RETURN'),('暂不继续','DEFAULT','ACCEPTED_STOP')]),('SETTLE',p+'settle',['清算后的选择']),('清算后的选择','GATEWAY',[('退汇',"selection == 'RETURN'",'RETURN'),('完成清算','DEFAULT','SETTLED')]),('RETURN',p+'returnPayment',['RETURNED']),('REJECTED','END',[]),('ACCEPTED_STOP','END',[]),('SETTLED','END',[]),('RETURNED','END',[])])
 l='loan_LoanApplicationController_';r='loan_LoanController_'
 build('loan','贷款生命周期：申请、审批、放款与逐期/提前还款',[
 ('START','START',['SUBMIT']),('SUBMIT',l+'submit',['审批选择']),('审批选择','GATEWAY',[('通过',"decision == 'APPROVE'",'APPROVE'),('拒绝','DEFAULT','REJECT')]),('APPROVE',l+'approve',['DISBURSE']),('REJECT',l+'reject',['REJECTED']),('DISBURSE',r+'disburse',['REPAY']),('REPAY',r+'repay',['剩余本金']),('剩余本金','GATEWAY',[('本金结清',"loan.outstandingPrincipal == 0",'CLOSED'),('仍有待还期次','DEFAULT','继续还款选择')]),('继续还款选择','GATEWAY',[('下次还款',"selection == 'REPAY'",'REPAY'),('本次流程暂停','DEFAULT','ACTIVE_STOP')]),('REJECTED','END',[]),('CLOSED','END',[]),('ACTIVE_STOP','END',[])])
 w='workflow_WorkflowTaskController_'
 # resolve actual controller name by operation to avoid inventing identifiers
 ws={b['id'].rsplit('_',1)[-1]:b['id']for b in beh if b['context']=='workflow'and b['behaviorType']=='COMMAND'}
 if all(k in ws for k in ['create','approve','reject']):
  build('workflow','工作流任务：创建与通过/拒绝决策', [('START','START',['CREATE']),('CREATE',ws['create'],['审批结果选择']),('审批结果选择','GATEWAY',[('通过',"decision == 'APPROVE'",'APPROVE'),('拒绝','DEFAULT','REJECT')]),('APPROVE',ws['approve'],['APPROVED']),('REJECT',ws['reject'],['REJECTED']),('APPROVED','END',[]),('REJECTED','END',[])])
 d='dispute_DisputeController_'
 build('dispute','争议生命周期：复核、临时入账、拒付、判定与再次结案', [('START','START',['OPEN']),('OPEN',d+'open',['REVIEW']),('REVIEW',d+'review',['CREDIT']),('CREDIT',d+'provisionalCredit',['CHARGEBACK']),('CHARGEBACK',d+'chargeback',['DECIDE']),('DECIDE',d+'resolve',['案件判定']),('案件判定','GATEWAY',[('胜诉',"dispute.status == 'WON'",'CLOSE_WON'),('败诉','DEFAULT','CLOSE_LOST')]),('CLOSE_WON',d+'resolve',['CLOSED']),('CLOSE_LOST',d+'resolve',['CLOSED']),('CLOSED','END',[])])
 n='notification_NotificationController_'
 build('notification','通知生命周期：渲染并模拟投递的成功/失败', [('START','START',['CREATE']),('CREATE',n+'create',['投递结果']),('投递结果','GATEWAY',[('已发送',"notification.status == 'SENT'",'SENT'),('模拟投递失败','DEFAULT','FAILED')]),('SENT','END',[]),('FAILED','END',[])])
 d='document_DocumentController_'
 build('document','文档生命周期：上传、归档与删除', [('START','START',['UPLOAD']),('UPLOAD',d+'upload',['后续文档操作']),('后续文档操作','GATEWAY',[('归档',"selection == 'ARCHIVE'",'ARCHIVE'),('删除',"selection == 'DELETE'",'DELETE'),('保留','DEFAULT','RETAINED')]),('ARCHIVE',d+'archive',['归档后操作']),('归档后操作','GATEWAY',[('删除',"selection == 'DELETE'",'DELETE'),('保留归档','DEFAULT','ARCHIVED')]),('DELETE',d+'delete',['DELETED']),('RETAINED','END',[]),('ARCHIVED','END',[]),('DELETED','END',[])])
 c='collections_DelinquencyCaseController_'
 build('collections','催收生命周期：重算逾期、承诺还款与解决', [('START','START',['OPEN']),('OPEN',c+'open',['后续催收操作']),('后续催收操作','GATEWAY',[('重算逾期',"selection == 'RECALCULATE'",'RECALCULATE'),('承诺还款',"selection == 'PROMISE'",'PROMISE'),('解决案件',"selection == 'RESOLVE'",'RESOLVE'),('暂停操作','DEFAULT','ACTIVE_STOP')]),('RECALCULATE',c+'recalculate',['后续催收操作']),('PROMISE',c+'promiseToPay',['后续催收操作']),('RESOLVE',c+'resolve',['RESOLVED']),('RESOLVED','END',[]),('ACTIVE_STOP','END',[])])
 build('fraud','欺诈评估与告警确认/排除', [('START','START',['EVALUATE']),('EVALUATE','fraud_FraudEvaluationController_evaluate',['是否产生告警']),('是否产生告警','GATEWAY',[('有告警',"result.alert != null",'告警处理选择'),('无告警','DEFAULT','NO_ALERT')]),('告警处理选择','GATEWAY',[('确认欺诈',"decision == 'CONFIRM'",'CONFIRM'),('排除告警','DEFAULT','DISMISS')]),('CONFIRM','fraud_FraudAlertController_confirm',['CONFIRMED']),('DISMISS','fraud_FraudAlertController_dismiss',['DISMISSED']),('NO_ALERT','END',[]),('CONFIRMED','END',[]),('DISMISSED','END',[])])
 build('aml','反洗钱筛查与告警排除/升级', [('START','START',['SCREEN']),('SCREEN','aml_ScreeningController_screen',['是否产生告警']),('是否产生告警','GATEWAY',[('有告警',"result.alert != null",'告警处理选择'),('无告警','DEFAULT','NO_ALERT')]),('告警处理选择','GATEWAY',[('升级',"decision == 'ESCALATE'",'ESCALATE'),('排除','DEFAULT','CLEAR')]),('ESCALATE','aml_AmlAlertController_escalate',['ESCALATED']),('CLEAR','aml_AmlAlertController_clear',['CLEARED']),('NO_ALERT','END',[]),('ESCALATED','END',[]),('CLEARED','END',[])])
 b='billing_StatementController_'
 build('billing','账单生命周期：生成、支付与幂等返回', [('START','START',['GENERATE']),('GENERATE',b+'generate',['是否继续支付']),('是否继续支付','GATEWAY',[('支付账单',"selection == 'PAY'",'PAY'),('暂不支付','DEFAULT','GENERATED_STOP')]),('PAY',b+'pay',['PAID']),('PAID','END',[]),('GENERATED_STOP','END',[])])
 for c,controller,title in [('transaction','PostingBatchController','过账批次：入账与可选冲正'),('ledger','JournalEntryController','总账凭证：记账与可选冲正')]:
  prefix=c+'_'+controller+'_';entry='create'if c=='transaction'else'post'
  build(c,title,[('START','START',['POST']),('POST',prefix+entry,['是否冲正']),('是否冲正','GATEWAY',[('执行冲正',"selection == 'REVERSE'",'REVERSE'),('保留入账','DEFAULT','POSTED')]),('REVERSE',prefix+'reverse',['REVERSED']),('POSTED','END',[]),('REVERSED','END',[])])
 return result
