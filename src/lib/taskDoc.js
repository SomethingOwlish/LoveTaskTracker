/* Форма документа задачи — общая для приложения и расширения Chrome.
   Приложение пишет через firebase/firestore, расширение — через
   firebase/firestore/lite. Классы Timestamp у них разные, поэтому
   serverTimestamp и Timestamp передаются снаружи. */

export function buildTaskDoc(data, { serverTimestamp, Timestamp }) {
  const assigneeUid = data.assigneeUid || data.authorUid;
  return {
    title: data.title?.trim() || 'Без названия',
    description: data.description || '',
    authorUid: data.authorUid,
    assigneeUid,
    status: 'open',
    needsReview: !!data.needsReview,
    priorityMatrix: { importance: data.importance ?? 0, urgency: data.urgency ?? 0 },
    deadline: data.deadline ? Timestamp.fromDate(new Date(data.deadline)) : null,
    estimateMin: data.estimateMin ?? null,
    actualMin: data.actualMin ?? null,
    tags: data.tags || [],
    projectTags: data.projectTags || [],
    link: data.link || null,
    checklist: data.checklist || [],
    recurrence: data.recurrence || 'none',
    likes: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    completedAt: null,
  };
}

// Уведомление исполнителю, если задачу поставил другой. null — уведомлять некого.
export function assignedNotification(taskId, taskDoc) {
  if (!taskDoc.assigneeUid || taskDoc.assigneeUid === taskDoc.authorUid) return null;
  return { type: 'assigned', taskId, taskTitle: taskDoc.title, actorUid: taskDoc.authorUid, recipientUid: taskDoc.assigneeUid };
}
