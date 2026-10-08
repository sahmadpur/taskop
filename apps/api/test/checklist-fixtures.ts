import { blankContent, type ChecklistContent, newItem, newRule, newSection, type YesNoItem } from '@taskop/contracts';

/** One yes/no item; "yes" is a critical problem that requires a photo and asks a follow-up comment. */
export function sampleContent(): ChecklistContent {
  const yn = newItem('yes_no') as YesNoItem;
  yn.label = 'Problem varmı?';
  const rule = newRule(yn);
  rule.when = { kind: 'options', optionIds: [yn.options[0].id] };
  rule.then.problem = 'critical';
  rule.then.requirePhoto = true;
  const describeIt = newItem('comment');
  describeIt.label = 'Təsvir edin';
  rule.then.followUps.push(describeIt);
  yn.rules.push(rule);
  return { ...blankContent(), sections: [{ ...newSection('Giriş'), items: [yn] }] };
}
