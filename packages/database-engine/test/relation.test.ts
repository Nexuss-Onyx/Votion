/**
 * Relation resolution, two-way sync and rollup aggregation tests.
 */

import { describe, expect, it } from 'vitest';
import type { CollectionSchema, UUID } from '@votion/types';
import {
  RelationResolver,
  relationIds,
  resolveRelationIds,
} from '../src/relation/RelationResolver.js';
import { RollupEngine } from '../src/relation/RollupEngine.js';
import { computeRecordCellValue } from '../src/relation/computed.js';
import { makeCollection, makeRecord, makeTestSchema, titledRecord } from './support/fixtures.js';

const { schema: baseSchema, titleId } = makeTestSchema();

const TASK_ID = 'collection-task-0000-0000-00000000001';
const PROJECT_ID = 'collection-project-0000-0000-000000001';

const hoursId = 'prop_hours';
const dueId = 'prop_due';
const projectsId = 'prop_projects';
const mirrorId = 'prop_tasks_mirror';
const doubleId = 'prop_double';
const taskCountId = 'prop_task_count';
const avgHoursId = 'prop_avg_hours';
const earliestId = 'prop_earliest';

const taskSchema: CollectionSchema = {
  ...baseSchema,
  [hoursId]: { name: 'Hours', type: 'number', number_format: 'number' },
  [dueId]: { name: 'Due', type: 'date', date_format: 'year_month_day' },
  [projectsId]: {
    name: 'Projects',
    type: 'relation',
    collection_id: PROJECT_ID,
    relation: { collection_id: PROJECT_ID, property_id: mirrorId },
  },
  [doubleId]: { name: 'Double', type: 'formula', formula: 'prop("Hours") * 2' },
};

const projectSchema: CollectionSchema = {
  [titleId]: { name: 'Name', type: 'title' },
  [mirrorId]: {
    name: 'Tasks',
    type: 'relation',
    collection_id: TASK_ID,
    relation: { collection_id: TASK_ID, property_id: projectsId },
  },
  [taskCountId]: {
    name: 'Task count',
    type: 'rollup',
    relation_property_id: mirrorId,
    target_property_id: titleId,
    rollup: { relation_property_id: mirrorId, target_property_id: titleId, aggregation: 'count_all' },
  },
  [avgHoursId]: {
    name: 'Average hours',
    type: 'rollup',
    relation_property_id: mirrorId,
    target_property_id: hoursId,
    rollup: { relation_property_id: mirrorId, target_property_id: hoursId, aggregation: 'average' },
  },
  [earliestId]: {
    name: 'Earliest due',
    type: 'rollup',
    relation_property_id: mirrorId,
    target_property_id: dueId,
    rollup: { relation_property_id: mirrorId, target_property_id: dueId, aggregation: 'earliest_date' },
  },
};

const taskCollection = makeCollection(taskSchema, { id: TASK_ID });
const projectCollection = makeCollection(projectSchema, { id: PROJECT_ID });

describe('RelationResolver', () => {
  const { project, task1, task2, task3 } = (() => {
    const project = titledRecord(projectCollection, 'Project 1');
    const task1 = titledRecord(taskCollection, 'Task 1', { [projectsId]: [project.id] });
    const task2 = titledRecord(taskCollection, 'Task 2', { [projectsId]: [project.id] });
    const task3 = titledRecord(taskCollection, 'Task 3', { [projectsId]: [] });
    return { project, task1, task2, task3 };
  })();

  const byId = new Map(
    [project, task1, task2, task3].map((record) => [record.id, record]),
  );

  const resolver = new RelationResolver({
    getRecord: (id) => byId.get(id),
    getSchema: (id) => (id === TASK_ID ? taskSchema : projectSchema),
  });

  it('normalises relation payloads', () => {
    expect(relationIds(['a', 'b'])).toEqual(['a', 'b']);
    expect(relationIds('a')).toEqual(['a']);
    expect(relationIds(null)).toEqual([]);
    expect(resolveRelationIds([])).toEqual([]);
  });

  it('resolves relation targets and target schemas', () => {
    const projects = taskSchema[projectsId];
    if (!projects) throw new Error('missing relation property');
    const targets = resolver.resolveTargets(task1, projectsId, projects);
    expect(targets.map((record) => record.id)).toEqual([project.id]);
    expect(resolver.targetCollectionId(projects)).toBe(PROJECT_ID);
    expect(resolver.targetSchema(projects)).toBe(projectSchema);
    expect(resolver.mirroredPropertyId(projects)).toBe(mirrorId);
  });

  it('computes minimal two-way mirror patches', () => {
    const projects = taskSchema[projectsId];
    if (!projects) throw new Error('missing relation property');
    const added = resolver.syncTwoWay(task3, projectsId, projects, [project.id]);
    expect(added).toEqual([
      { recordId: project.id, propertyId: mirrorId, value: [task3.id] },
    ]);

    const projectWithLinks = {
      ...project,
      properties: { ...project.properties, [mirrorId]: [task1.id, task3.id] },
    };
    const byIdWithLinks = new Map(byId);
    byIdWithLinks.set(project.id, projectWithLinks);
    const linkedResolver = new RelationResolver({
      getRecord: (id) => byIdWithLinks.get(id),
      getSchema: (id) => (id === TASK_ID ? taskSchema : projectSchema),
    });
    const task3Linked = {
      ...task3,
      properties: { ...task3.properties, [projectsId]: [project.id] },
    };
    const removed = linkedResolver.syncTwoWay(task3Linked, projectsId, projects, []);
    expect(removed).toEqual([
      { recordId: project.id, propertyId: mirrorId, value: [task1.id] },
    ]);
  });

  it('builds relation transactions and mirror operations', () => {
    const projects = taskSchema[projectsId];
    if (!projects) throw new Error('missing relation property');
    const tx = resolver.buildSetRelationTransaction(task1, projectsId, [project.id]);
    expect(tx.operations[0]).toMatchObject({
      command: 'set',
      path: ['properties', projectsId],
      args: [project.id],
    });
    const ops = resolver.buildMirrorOperations(task3, projectsId, projects, [project.id]);
    expect(ops[0]).toMatchObject({ command: 'set', path: ['properties', mirrorId] });
  });
});

describe('RollupEngine', () => {
  const project = titledRecord(projectCollection, 'Project 1');
  const task1 = titledRecord(taskCollection, 'Task 1', {
    [hoursId]: 2,
    [dueId]: '2026-01-10',
    [projectsId]: [],
  });
  const task2 = titledRecord(taskCollection, 'Task 2', {
    [hoursId]: 3,
    [dueId]: '2026-02-10',
    [projectsId]: [],
  });
  const task3 = titledRecord(taskCollection, 'Task 3', {
    [hoursId]: 5,
    [dueId]: '2026-03-10',
    [projectsId]: [project.id],
  });
  const byId = new Map([project, task1, task2, task3].map((record) => [record.id, record]));
  const resolver = new RelationResolver({
    getRecord: (id) => byId.get(id),
    getSchema: (id) => (id === TASK_ID ? taskSchema : projectSchema),
  });
  const engine = new RollupEngine({
    resolver,
    getSchema: (id) => (id === TASK_ID ? taskSchema : projectSchema),
  });

  function makeProjectWith(tasks: string[]) {
    return {
      ...project,
      properties: { ...project.properties, [mirrorId]: tasks },
    };
  }

  it('aggregates count, sum, average, median, min, max and range', () => {
    const record = makeProjectWith([task1.id, task2.id, task3.id]);
    const config = (aggregation: 'count_all' | 'sum' | 'average' | 'median' | 'min' | 'max' | 'range') => ({
      name: 'agg',
      type: 'rollup' as const,
      relation_property_id: mirrorId,
      target_property_id: hoursId,
      rollup: { relation_property_id: mirrorId, target_property_id: hoursId, aggregation },
    });
    expect(engine.compute(record, projectSchema, 'c1', config('count_all')).value).toBe(3);
    expect(engine.compute(record, projectSchema, 'c2', config('sum')).value).toBe(10);
    expect(engine.compute(record, projectSchema, 'c3', config('average')).value).toBeCloseTo(10 / 3);
    expect(engine.compute(record, projectSchema, 'c4', config('median')).value).toBe(3);
    expect(engine.compute(record, projectSchema, 'c5', config('min')).value).toBe(2);
    expect(engine.compute(record, projectSchema, 'c6', config('max')).value).toBe(5);
    expect(engine.compute(record, projectSchema, 'c7', config('range')).value).toBe(3);
  });

  it('computes configured rollups on the project schema', () => {
    const record = makeProjectWith([task1.id, task2.id, task3.id]);
    expect(
      engine.compute(record, projectSchema, taskCountId, projectSchema[taskCountId]!).value,
    ).toBe(3);
    expect(
      engine.compute(record, projectSchema, avgHoursId, projectSchema[avgHoursId]!).value,
    ).toBeCloseTo(10 / 3);
    expect(
      engine.compute(record, projectSchema, earliestId, projectSchema[earliestId]!).value,
    ).toBe('2026-01-10T00:00:00.000Z');
  });

  it('supports percent and unique aggregations', () => {
    const record = makeProjectWith([task1.id, task2.id]);
    const uniqueConfig = {
      name: 'unique',
      type: 'rollup' as const,
      relation_property_id: mirrorId,
      target_property_id: titleId,
      rollup: { relation_property_id: mirrorId, target_property_id: titleId, aggregation: 'show_unique' as const },
    };
    const result = engine.compute(record, projectSchema, 'u1', uniqueConfig);
    expect(result.display).toBe('Task 1, Task 2');

    const percentConfig = {
      name: 'percent',
      type: 'rollup' as const,
      relation_property_id: mirrorId,
      target_property_id: titleId,
      rollup: { relation_property_id: mirrorId, target_property_id: titleId, aggregation: 'percent_not_empty' as const },
    };
    expect(engine.compute(record, projectSchema, 'p1', percentConfig).display).toBe('100%');
  });
});

describe('computed cell values', () => {
  it('evaluates formula properties through the schema context', () => {
    const task = makeRecord(taskCollection, {
      [titleId]: [['Task']],
      [hoursId]: 4,
      [doubleId]: null,
    });
    const value = computeRecordCellValue(task, taskSchema, doubleId, taskSchema[doubleId]!);
    expect(value).toBe(8);
  });

  it('returns raw values for non-computed properties', () => {
    const task = makeRecord(taskCollection, { [titleId]: [['Task']], [hoursId]: 4 });
    expect(computeRecordCellValue(task, taskSchema, hoursId, taskSchema[hoursId]!)).toBe(4);
  });
});
