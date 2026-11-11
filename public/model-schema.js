const text=(label,type='text',extra={})=>({label,type,...extra}),ref=(label,model)=>text(label,'ref',{model});
export const EDIT_SCHEMAS={
 M1:{label:text('对象名称'),description:text('业务定义','textarea'),attributes:text('属性列表','array'),invariants:text('聚合约束','array'),lifecycle:text('生命周期','array')},
 M2:{label:text('行为名称'),description:text('行为说明','textarea'),ownerEntity:ref('所属对象','M1'),behaviorType:text('行为类型','enum',{options:['COMMAND','QUERY']}),triggerType:text('触发方式','enum',{options:['USER_ACTION','SYSTEM','EVENT','EXTERNAL']}),preconditions:text('前置条件','array'),postconditions:text('后置条件','array'),appliedRules:text('引用规则','refs',{model:'M3'}),requiredPermissions:text('权限ID','array'),queryReportRef:ref('查询报表','M7')},
 M3:{label:text('规则名称'),description:text('业务定义','textarea'),expression:text('规则表达式','textarea'),inputParams:text('输入参数','array'),outputType:text('输出类型')},
 M5:{label:text('角色名称'),description:text('职责范围','textarea'),permissions:text('权限ID','array'),inheritsFrom:text('继承角色','array')},
 M6:{label:text('流程名称'),description:text('流程说明','textarea'),roleRefs:text('参与角色','refs',{model:'M5'}),activities:text('活动定义','array'),nodeGraph:text('节点与有向边','object'),businessObjectRefs:text('业务对象','refs',{model:'M1'})},
 M7:{label:text('查询名称'),description:text('查询说明','textarea'),behaviorRef:ref('承接查询行为（同步双向绑定）','M2'),sourceObjects:text('查询来源','array'),joins:text('关联条件','array'),parameters:text('查询参数','array'),resultColumns:text('结果列','array')},
 MU:{label:text('界面名称'),description:text('界面说明','textarea'),actions:text('交互动作','array'),elements:text('界面元素','array')},
 ME:{label:text('事件名称'),description:text('事实定义','textarea'),producerBehaviorRef:ref('生产行为','M2'),producerEntityRef:ref('来源对象','M1'),payload:text('载荷定义','array'),subscribers:text('订阅关系','array')},
 M4:{label:text('场景名称'),description:text('协同说明','textarea'),triggerEventRef:ref('触发事件','ME'),sourceObjectRef:ref('来源对象','M1'),targetObjectRefs:text('目标对象','refs',{model:'M1'}),steps:text('事件协同步骤','array')},
 MM:{label:text('映射名称'),description:text('映射说明','textarea'),objectRef:ref('业务对象','M1'),tableMappings:text('表与列映射','array')},
 MI:{label:text('接口名称'),description:text('接口目的','textarea'),interfaceType:text('方向','enum',{options:['PROVIDED','DEPENDENT']}),behaviorRef:ref('承接行为','M2'),endpoint:text('HTTP方法和路径','object'),inputParameters:text('输入参数','array'),outputResult:text('返回定义','array'),returnRules:text('返回规则','array')}
};
export function checkChanges(model,changes,original={}){const schema=EDIT_SCHEMAS[model];if(!schema)throw Error('当前模型不支持结构编辑');for(const[k,v]of Object.entries(changes)){const f=schema[k];if(!f)throw Error('不支持修改字段：'+k);if(f.type==='array'||f.type==='refs'){if(!Array.isArray(v))throw Error(f.label+'必须为数组')}else if(f.type==='object'){if(!v||typeof v!=='object'||Array.isArray(v))throw Error(f.label+'必须为对象')}else if(v!==null&&typeof v!=='string')throw Error(f.label+'必须为文本');if(f.type==='enum'&&v!==''&&v!==null&&!f.options.includes(v)&&v!==original[k])throw Error(f.label+'值不受支持')}return true}

export const ARRAY_FIELDS={
 attributes:{name:'字段名',label:'中文名',type:'类型',required:'bool:必填',targetAggregate:'ref:M1'},
 inputParameters:{name:'参数名',label:'中文名',dataType:'类型',required:'bool:必填',binding:'绑定声明'},
 inputParams:{name:'参数名',type:'类型',required:'bool:必填',sourceField:'来源字段'},
 outputResult:{name:'返回字段',dataType:'类型',description:'业务说明'},
 resultColumns:{name:'结果字段',label:'中文名',dataType:'类型',sourceField:'来源字段'},
 payload:{name:'载荷字段',type:'类型',required:'bool:必填',description:'说明'},
 invariants:{name:'约束名称',expression:'表达式',violationMessage:'违反提示'},
 tableMappings:{tableName:'表名',tableRole:'主从角色',primaryKey:'主键',columnMappings:'array:列映射'},
 columnMappings:{attributeRef:'对象属性',column:'数据库列',columnType:'数据库类型',nullable:'bool:可为空',mappingStatus:'核验状态'},
 steps:{stepId:'步骤ID',stepType:'步骤类型',behaviorRef:'ref:M2',eventRef:'ref:ME',ruleRef:'ref:M3',nextSteps:'json:后继步骤ID数组'},
 activities:{activityId:'活动ID',name:'活动名称',type:'活动类型',roleRef:'ref:M5',behaviorRef:'ref:M2',subFlowRef:'ref:M6'},
 subscribers:{subscriberId:'订阅ID',behaviorRef:'ref:M2',ruleRef:'ref:M3'}
};
