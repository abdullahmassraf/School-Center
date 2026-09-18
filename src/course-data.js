// ============================================================================
// src/course-data.js — Explicit Course Content Routing Rules
// ============================================================================

const BG_ASSIGNMENT_TITLES = new Set([
  'Background Assignment ENGR43301D Engineering Economics and Entrepreneurship',
  'Abdullah Massraf Biography'
]);

export const COURSE_ASSIGNMENT_FOLDERS = {
  engr43301d: [
    {
      folderId: 'bg_assignment_bio_combined',
      folderName: 'Background Assignment & Biography',
      items: [
        {
          title: 'Background Assignment ENGR43301D Engineering Economics and Entrepreneurship',
          type: 'document'
        },
        {
          title: 'Abdullah Massraf Biography',
          type: 'document'
        }
      ]
    }
  ]
};

export function routeCourseContent(course) {
  const mats = Array.isArray(course?.cloudMaterials) ? course.cloudMaterials : [];
  const rules = COURSE_ASSIGNMENT_FOLDERS[course?.id] || [];
  if (!rules.length) {
    return { materials: mats, assignmentFolders: [] };
  }

  const normalizeTitle = value => String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\\s+/g, ' ')
    .trim()
    .toLowerCase();

  const assignmentTitles = new Set(rules.flatMap(folder => folder.items.map(item => normalizeTitle(item.title))));
  const routedItems = new Map();
  mats.forEach(material => {
    const key = normalizeTitle(material?.title);
    if (!assignmentTitles.has(key)) return;
    if (!routedItems.has(key)) routedItems.set(key, material);
  });

  const assignmentFolders = rules.map(folder => ({
    ...folder,
    items: folder.items.map(spec => ({
      ...spec,
      material: routedItems.get(normalizeTitle(spec.title)) || null
    }))
  }));

  return {
    materials: mats.filter(material => !assignmentTitles.has(normalizeTitle(material?.title))),
    assignmentFolders
  };
}
