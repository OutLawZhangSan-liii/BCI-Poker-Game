import { ThemedDropdown } from "./ThemedDropdown";
import type { TeachingCourse } from "../teaching/courses";

interface Props {
  courses: TeachingCourse[];
  currentId: TeachingCourse["id"];
  completed: Set<TeachingCourse["id"]>;
  disabled?: boolean;
  onSelect: (id: TeachingCourse["id"]) => void;
}

export function TeachingCourseNav({ courses, currentId, completed, disabled = false, onSelect }: Props) {
  const currentIndex = courses.findIndex((course) => course.id === currentId);
  return <div className="teaching-course-nav" aria-label="教学课程">
    <nav className="teaching-course-nav__desktop" aria-label="课程目录">
      {courses.map((course, index) => <button key={course.id} type="button" className={course.id === currentId ? "" : "secondary"}
        aria-current={course.id === currentId ? "step" : undefined} aria-label={`${index + 1}. ${course.title}`} disabled={disabled} onClick={() => onSelect(course.id)}>
        <span>{index + 1}</span>{course.shortTitle}{completed.has(course.id) ? " ✓" : ""}
      </button>)}
    </nav>
    <ThemedDropdown className="teaching-course-picker" theme="course" label="当前课程" ariaLabel="选择课程" menuLabel="课程目录"
      value={currentId} disabled={disabled} onChange={onSelect}
      displayValue={`${String(currentIndex + 1).padStart(2, "0")} · ${courses[currentIndex]?.title}`}
      options={courses.map((course, index) => ({ value: course.id, label: course.title,
        prefix: String(index + 1).padStart(2, "0"), suffix: completed.has(course.id) ? "·" : "" }))} />
  </div>;
}
