using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shapes;
using System.Windows.Threading;
using Microsoft.Win32;
using System.Text.Json;
using System.Windows.Media.Animation;
using System.Media;
using IOPath = System.IO.Path;

namespace WL_Editor
{
    public partial class MainWindow : Window
    {
        #region Fields and Properties

        // 뷰포트 및 줌
        private double zoom = 30;
        private Point viewOffset = new Point(0, 0);
        private bool isPanning = false;
        private Point lastMousePos;

        // 재생 관련
        private bool isPlaying = false;
        private bool isPaused = false;
        private DateTime startTime;
        private double elapsedTime = 0;
        private DispatcherTimer playbackTimer;
        private DispatcherTimer animationTimer;

        // 오디오
        private MediaPlayer mediaPlayer;
        private SoundPlayer tabSoundPlayer;
        private string audioFilePath;
        private double audioFileSize;
        private double musicVolume = 0.5;
        private double sfxVolume = 1.0;

        // 노트 데이터
        private ObservableCollection<Note> notes = new ObservableCollection<Note>();
        private HashSet<string> playedNotes = new HashSet<string>();

        // 플레이어
        private Point demoPlayerPosition = new Point(0, 0);

        // 웨이브폼
        private double waveformZoom = 1.0;
        private double waveformOffset = 0;
        private bool hasAudioFile = false;
        private double audioDuration = 0;

        // 하이라이트
        private int highlightedNoteIndex = -1;
        private double highlightedNoteTimer = 0;
        private double pathHighlightTimer = 0;

        // 상수
        private const double MUSIC_START_TIME = 3.0;
        private const int MAC_DELAY_OFFSET = 800;

        #endregion

        #region Constructor and Initialization

        public MainWindow()
        {
            InitializeComponent();
            InitializeApplication();
        }

        private void InitializeApplication()
        {
            // 타이머 초기화
            playbackTimer = new DispatcherTimer();
            playbackTimer.Interval = TimeSpan.FromMilliseconds(33); // 30 FPS
            playbackTimer.Tick += PlaybackTimer_Tick;

            animationTimer = new DispatcherTimer();
            animationTimer.Interval = TimeSpan.FromMilliseconds(33); // 30 FPS
            animationTimer.Tick += AnimationTimer_Tick;

            // 미디어 플레이어 초기화
            mediaPlayer = new MediaPlayer();
            mediaPlayer.Volume = musicVolume;

            // 효과음 플레이어 초기화
            try
            {
                var tabSoundPath = IOPath.Combine(AppDomain.CurrentDomain.BaseDirectory, "sfx", "tab.wav");
                if (File.Exists(tabSoundPath))
                {
                    tabSoundPlayer = new SoundPlayer(tabSoundPath);
                    tabSoundPlayer.Load();
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"효과음 로드 실패: {ex.Message}");
            }

            // 노트 리스트 바인딩
            NoteListDataGrid.ItemsSource = notes;

            // 설정 변경 이벤트 바인딩
            BpmTextBox.TextChanged += SettingsChanged;
            PreDelayTextBox.TextChanged += SettingsChanged;
            SubdivisionsComboBox.SelectionChanged += SettingsChanged;

            // 초기 노트 추가
            EnsureInitialDirectionNote();

            // 초기 뷰포트 설정
            viewOffset = new Point(MainCanvas.ActualWidth / 2, MainCanvas.ActualHeight / 2);

            // 로컬 스토리지에서 데이터 로드
            LoadFromStorage();

            // 초기 그리기
            DrawPath();

            // 윈도우 로드 완료 후 추가 초기화
            Loaded += MainWindow_Loaded;
            Closing += MainWindow_Closing;
        }

        private void MainWindow_Closing(object sender, System.ComponentModel.CancelEventArgs e)
        {
            // 리소스 정리
            try
            {
                mediaPlayer?.Close();
                tabSoundPlayer?.Dispose();
                playbackTimer?.Stop();
                animationTimer?.Stop();
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"리소스 정리 중 오류: {ex.Message}");
            }
        }

        private void MainWindow_Loaded(object sender, RoutedEventArgs e)
        {
            // 텍스트 렌더링 옵션 설정
            TextOptions.SetTextFormattingMode(this, TextFormattingMode.Display);
            TextOptions.SetTextRenderingMode(this, TextRenderingMode.ClearType);

            // 캔버스 크기 조정
            ResizeCanvas();
            DrawPath();
        }

        #endregion

        #region Note Data Model

        public class Note : INotifyPropertyChanged
        {
            private string type;
            private int beat;
            private string direction = "none";

            public int Index { get; set; }
            public string Type
            {
                get => type;
                set { type = value; OnPropertyChanged(); OnPropertyChanged(nameof(TimeDisplay)); }
            }
            public int Beat
            {
                get => beat;
                set { beat = value; OnPropertyChanged(); OnPropertyChanged(nameof(TimeDisplay)); }
            }
            public string Direction
            {
                get => direction;
                set { direction = value; OnPropertyChanged(); }
            }

            public string TimeDisplay
            {
                get
                {
                    // BPM과 subdivisions 값을 가져와서 시간 계산
                    var mainWindow = Application.Current.MainWindow as MainWindow;
                    if (mainWindow != null)
                    {
                        var bpm = mainWindow.GetBpm();
                        var subdivisions = mainWindow.GetSubdivisions();
                        var preDelaySeconds = mainWindow.GetPreDelaySeconds(mainWindow);

                        var originalTime = BeatToTime(Beat, bpm, subdivisions);

                        if (Beat == 0 && Type == "direction")
                        {
                            return $"{originalTime:F3}s";
                        }
                        else
                        {
                            var finalTime = originalTime + preDelaySeconds;
                            return $"{finalTime:F3}s";
                        }
                    }
                    return "0.000s";
                }
            }

            public event PropertyChangedEventHandler PropertyChanged;
            public virtual void OnPropertyChanged([System.Runtime.CompilerServices.CallerMemberName] string propertyName = null)
            {
                PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
            }

            public static double BeatToTime(int beat, double bpm, int subdivisions)
            {
                return (beat * 60.0) / (bpm * subdivisions);
            }
        }

        #endregion

        #region Canvas Drawing
        private void ResizeCanvas()
        {
            if (MainCanvas.ActualWidth > 0 && MainCanvas.ActualHeight > 0)
            {
                MainCanvas.Width = MainCanvas.ActualWidth;
                MainCanvas.Height = MainCanvas.ActualHeight;
                System.Diagnostics.Debug.WriteLine($"Canvas resized: {MainCanvas.ActualWidth} x {MainCanvas.ActualHeight}");
            }
            else
            {
                System.Diagnostics.Debug.WriteLine("Canvas size is 0!");
            }
        }

        private void DrawPath()
        {
            if (playerVisual != null)
            {
                MainCanvas.Children.Remove(playerVisual);
                playerVisual = null;
            }

            System.Diagnostics.Debug.WriteLine($"DrawPath called: ViewOffset X={viewOffset.X:F1}, Y={viewOffset.Y:F1}, Zoom={zoom:F2}");

            MainCanvas.Children.Clear();
            EnsureInitialDirectionNote();

            var bpm = GetBpm();
            var subdivisions = GetSubdivisions();
            var preDelaySeconds = GetPreDelaySeconds(this);

            DrawGrid();

            // Direction 노트들을 처리
            var directionNotes = notes.Where(n => n.Type == "direction").OrderBy(n => n.Beat).ToList();
            var pathDirectionNotes = directionNotes.Select((note, index) =>
            {
                double pathBeat;
                if (note.Beat == 0 && note.Type == "direction")
                {
                    pathBeat = 0;
                }
                else
                {
                    var originalTime = BeatToTime(note.Beat, bpm, subdivisions);
                    var adjustedTime = originalTime + preDelaySeconds;
                    pathBeat = TimeToBeat(adjustedTime, bpm, subdivisions);
                }
                return new { Note = note, PathBeat = pathBeat };
            }).OrderBy(x => x.PathBeat).ToList();

            var nodePositions = new List<Point>();
            var pos = new Point(0, 0);
            nodePositions.Add(pos);

            // 경로 그리기
            var pathGeometry = new PathGeometry();
            var pathFigure = new PathFigure { StartPoint = new Point(pos.X * zoom + viewOffset.X, pos.Y * zoom + viewOffset.Y) };

            for (int i = 0; i < pathDirectionNotes.Count - 1; i++)
            {
                var a = pathDirectionNotes[i];
                var b = pathDirectionNotes[i + 1];
                var dBeat = b.PathBeat - a.PathBeat;
                var dist = (8 * dBeat) / subdivisions;
                var direction = DirectionToVector(a.Note.Direction);
                var mag = Math.Sqrt(direction.X * direction.X + direction.Y * direction.Y);
                if (mag == 0) mag = 1;

                var next = new Point(pos.X + (direction.X / mag) * dist, pos.Y + (direction.Y / mag) * dist);
                pathFigure.Segments.Add(new LineSegment(new Point(next.X * zoom + viewOffset.X, next.Y * zoom + viewOffset.Y), true));

                pos = next;
                nodePositions.Add(pos);
            }

            pathGeometry.Figures.Add(pathFigure);
            var pathElement = new System.Windows.Shapes.Path
            {
                Data = pathGeometry,
                Stroke = Brushes.Black,
                StrokeThickness = 2
            };
            MainCanvas.Children.Add(pathElement);

            // 정수 분박 위치에 점 표시
            DrawBeatMarkers(pathDirectionNotes.Cast<dynamic>().ToList(), nodePositions, subdivisions);

            // 노트 그리기
            DrawNotes(pathDirectionNotes.Cast<dynamic>().ToList(), nodePositions, bpm, subdivisions, preDelaySeconds);

            // 플레이어 그리기
            if (isPlaying)
            {
                DrawPlayer();
            }

            // 하이라이트 효과
            if (highlightedNoteIndex >= 0 && highlightedNoteTimer > 0)
            {
                DrawNoteHighlight(pathDirectionNotes.Cast<dynamic>().ToList(), nodePositions, bpm, subdivisions, preDelaySeconds);
            }

            // 경로 강조 효과
            if (pathHighlightTimer > 0)
            {
                DrawPathHighlight(pathDirectionNotes.Cast<dynamic>().ToList(), subdivisions);
            }

            needsFullRedraw = false;
        }

        private void DrawGrid()
        {
            const double gridSize = 8;
            var startX = Math.Floor(-viewOffset.X / zoom / gridSize) - 1;
            var endX = Math.Ceiling((MainCanvas.ActualWidth - viewOffset.X) / zoom / gridSize) + 1;
            var startY = Math.Floor(-viewOffset.Y / zoom / gridSize) - 1;
            var endY = Math.Ceiling((MainCanvas.ActualHeight - viewOffset.Y) / zoom / gridSize) + 1;

            var gridBrush = new SolidColorBrush(Color.FromArgb(51, 150, 150, 150)); // rgba(150, 150, 150, 0.2)

            // 세로 줄
            for (var i = startX; i <= endX; i++)
            {
                var x = i * gridSize * zoom + viewOffset.X;
                var line = new Line
                {
                    X1 = x,
                    Y1 = 0,
                    X2 = x,
                    Y2 = MainCanvas.ActualHeight,
                    Stroke = gridBrush,
                    StrokeThickness = 1
                };
                MainCanvas.Children.Add(line);
            }

            // 가로 줄
            for (var j = startY; j <= endY; j++)
            {
                var y = j * gridSize * zoom + viewOffset.Y;
                var line = new Line
                {
                    X1 = 0,
                    Y1 = y,
                    X2 = MainCanvas.ActualWidth,
                    Y2 = y,
                    Stroke = gridBrush,
                    StrokeThickness = 1
                };
                MainCanvas.Children.Add(line);
            }
        }

        private void DrawBeatMarkers(IList<dynamic> pathDirectionNotes, List<Point> nodePositions, int subdivisions)
        {
            var totalPathBeats = pathDirectionNotes.LastOrDefault()?.PathBeat ?? 0;

            for (var beat = subdivisions; beat < totalPathBeats; beat += subdivisions)
            {
                var pos = GetNotePositionFromPathData(beat, pathDirectionNotes, nodePositions, subdivisions);
                if (pos.HasValue)
                {
                    var ellipse = new Ellipse
                    {
                        Width = 8,
                        Height = 8,
                        Fill = new SolidColorBrush(Color.FromArgb(102, 128, 128, 128)) // rgba(128,128,128,0.4)
                    };
                    Canvas.SetLeft(ellipse, pos.Value.X * zoom + viewOffset.X - 4);
                    Canvas.SetTop(ellipse, pos.Value.Y * zoom + viewOffset.Y - 4);
                    MainCanvas.Children.Add(ellipse);
                }
            }
        }

        private void DrawNotes(IList<dynamic> pathDirectionNotes, List<Point> nodePositions, double bpm, int subdivisions, double preDelaySeconds)
        {
            foreach (var note in notes)
            {
                if (note.Beat == 0 && note.Type != "direction") continue;

                double pathBeat;
                if (note.Beat == 0 && note.Type == "direction")
                {
                    pathBeat = 0;
                }
                else
                {
                    var originalTime = BeatToTime(note.Beat, bpm, subdivisions);
                    var adjustedTime = originalTime + preDelaySeconds;
                    pathBeat = TimeToBeat(adjustedTime, bpm, subdivisions);
                }

                var pos = GetNotePositionFromPathData(pathBeat, pathDirectionNotes, nodePositions, subdivisions);
                if (!pos.HasValue) continue;

                var screenX = pos.Value.X * zoom + viewOffset.X;
                var screenY = pos.Value.Y * zoom + viewOffset.Y;

                if (note.Type == "tab")
                {
                    var ellipse = new Ellipse
                    {
                        Width = 10,
                        Height = 10,
                        Fill = note.Beat == 0 && note.Type == "direction" ? Brushes.Red : Brushes.LightCoral,
                        Stroke = note.Beat == 0 && note.Type == "direction" ? null : Brushes.LimeGreen,
                        StrokeThickness = 2
                    };
                    Canvas.SetLeft(ellipse, screenX - 5);
                    Canvas.SetTop(ellipse, screenY - 5);
                    MainCanvas.Children.Add(ellipse);
                }
                else if (note.Type == "direction")
                {
                    DrawDirectionNote(screenX, screenY, note.Direction, note.Beat == 0);
                }
            }
        }

        private void DrawDirectionNote(double x, double y, string direction, bool isInitial)
        {
            var dirVector = DirectionToVector(direction);
            var mag = Math.Sqrt(dirVector.X * dirVector.X + dirVector.Y * dirVector.Y);
            if (mag == 0) mag = 1;

            var ux = (dirVector.X / mag) * 16;
            var uy = (dirVector.Y / mag) * 16;
            var endX = x + ux;
            var endY = y + uy;

            // 메인 라인
            var line = new Line
            {
                X1 = x,
                Y1 = y,
                X2 = endX,
                Y2 = endY,
                Stroke = isInitial ? Brushes.Red : Brushes.LimeGreen,
                StrokeThickness = 2
            };
            MainCanvas.Children.Add(line);

            // 화살표 머리
            var perpX = -uy * 0.5;
            var perpY = ux * 0.5;

            var arrowHead = new Polygon
            {
                Points = new PointCollection
                {
                    new Point(endX, endY),
                    new Point(endX - ux * 0.4 + perpX, endY - uy * 0.4 + perpY),
                    new Point(endX - ux * 0.4 - perpX, endY - uy * 0.4 - perpY)
                },
                Fill = isInitial ? Brushes.Red : Brushes.LimeGreen
            };
            MainCanvas.Children.Add(arrowHead);
        }

        private void DrawPlayer()
        {
            var screenX = demoPlayerPosition.X * zoom + viewOffset.X;
            var screenY = demoPlayerPosition.Y * zoom + viewOffset.Y;

            var star = new Polygon
            {
                Fill = Brushes.Blue,
                Stroke = Brushes.Blue
            };

            // 별 모양 생성
            var points = new PointCollection();
            const int spikes = 5;
            const double outerRadius = 10;
            const double innerRadius = 4;

            for (int i = 0; i < spikes * 2; i++)
            {
                var radius = i % 2 == 0 ? outerRadius : innerRadius;
                var angle = (i * Math.PI) / spikes;
                var x = Math.Cos(angle) * radius;
                var y = Math.Sin(angle) * radius;
                points.Add(new Point(x, y));
            }

            star.Points = points;
            Canvas.SetLeft(star, screenX);
            Canvas.SetTop(star, screenY);
            MainCanvas.Children.Add(star);
        }

        private void DrawNoteHighlight(IList<dynamic> pathDirectionNotes, List<Point> nodePositions, double bpm, int subdivisions, double preDelaySeconds)
        {
            if (highlightedNoteIndex < 0 || highlightedNoteIndex >= notes.Count) return;

            var note = notes[highlightedNoteIndex];
            double pathBeat;

            if (note.Beat == 0 && note.Type == "direction")
            {
                pathBeat = 0;
            }
            else
            {
                var originalTime = BeatToTime(note.Beat, bpm, subdivisions);
                var adjustedTime = originalTime + preDelaySeconds;
                pathBeat = TimeToBeat(adjustedTime, bpm, subdivisions);
            }

            var pos = GetNotePositionFromPathData(pathBeat, pathDirectionNotes, nodePositions, subdivisions);
            if (!pos.HasValue) return;

            var x = pos.Value.X * zoom + viewOffset.X;
            var y = pos.Value.Y * zoom + viewOffset.Y;

            var alpha = Math.Min(1, highlightedNoteTimer * 2);
            var radius = 15 + (0.5 - highlightedNoteTimer) * 30;

            var ellipse = new Ellipse
            {
                Width = radius * 2,
                Height = radius * 2,
                Stroke = new SolidColorBrush(Color.FromArgb((byte)(alpha * 255), 255, 200, 0)),
                StrokeThickness = 3,
                Fill = Brushes.Transparent
            };
            Canvas.SetLeft(ellipse, x - radius);
            Canvas.SetTop(ellipse, y - radius);
            MainCanvas.Children.Add(ellipse);
        }

        private void DrawPathHighlight(IList<dynamic> pathDirectionNotes, int subdivisions)
        {
            var pathGeometry = new PathGeometry();
            var pathFigure = new PathFigure { StartPoint = new Point(viewOffset.X, viewOffset.Y) };

            var pos = new Point(0, 0);
            for (int i = 0; i < pathDirectionNotes.Count - 1; i++)
            {
                var a = pathDirectionNotes[i];
                var b = pathDirectionNotes[i + 1];
                var dBeat = b.PathBeat - a.PathBeat;
                var dist = (8 * dBeat) / subdivisions;
                var direction = DirectionToVector(a.Note.Direction);
                var mag = Math.Sqrt(direction.X * direction.X + direction.Y * direction.Y);
                if (mag == 0) mag = 1;

                var next = new Point(pos.X + (direction.X / mag) * dist, pos.Y + (direction.Y / mag) * dist);
                pathFigure.Segments.Add(new LineSegment(new Point(next.X * zoom + viewOffset.X, next.Y * zoom + viewOffset.Y), true));
                pos = next;
            }

            pathGeometry.Figures.Add(pathFigure);
            var pathElement = new System.Windows.Shapes.Path
            {
                Data = pathGeometry,
                Stroke = new SolidColorBrush(Color.FromArgb((byte)(pathHighlightTimer * 255), 255, 100, 100)),
                StrokeThickness = 4
            };
            MainCanvas.Children.Add(pathElement);
        }

        #endregion

        #region Helper Methods

        private void EnsureInitialDirectionNote()
        {
            if (!notes.Any(n => n.Beat == 0 && n.Type == "direction"))
            {
                notes.Insert(0, new Note { Type = "direction", Beat = 0, Direction = "none" });
            }
            UpdateNoteIndices();
        }

        private void UpdateNoteIndices()
        {
            for (int i = 0; i < notes.Count; i++)
            {
                notes[i].Index = i;
            }
        }

        private Point DirectionToVector(string direction)
        {
            return direction switch
            {
                "up" => new Point(0, -1),
                "down" => new Point(0, 1),
                "left" => new Point(-1, 0),
                "right" => new Point(1, 0),
                "upleft" => new Point(-1, -1),
                "upright" => new Point(1, -1),
                "downleft" => new Point(-1, 1),
                "downright" => new Point(1, 1),
                _ => new Point(0, 0)
            };
        }

        private double BeatToTime(int beat, double bpm, int subdivisions)
        {
            return (beat * 60.0) / (bpm * subdivisions);
        }

        private int TimeToBeat(double time, double bpm, int subdivisions)
        {
            return (int)Math.Round((time * bpm * subdivisions) / 60.0);
        }

        public double GetPreDelaySeconds(MainWindow window)
        {
            if (int.TryParse(window.PreDelayTextBox.Text, out var preDelayMs))
            {
                return preDelayMs / 1000.0;
            }
            return 3.0; // 기본값
        }

        public double GetBpm()
        {
            if (double.TryParse(BpmTextBox.Text, out var bpm))
            {
                return bpm;
            }
            return 120.0; // 기본값
        }

        public int GetSubdivisions()
        {
            var selectedItem = SubdivisionsComboBox.SelectedItem as ComboBoxItem;
            if (selectedItem != null && int.TryParse(selectedItem.Tag.ToString(), out var subdivisions))
            {
                return subdivisions;
            }
            return 16; // 기본값
        }

        private Point? GetNotePositionFromPathData(double pathBeat, IList<dynamic> pathDirectionNotes, List<Point> nodePositions, int subdivisions)
        {
            for (int i = 0; i < pathDirectionNotes.Count - 1; i++)
            {
                var a = pathDirectionNotes[i];
                var b = pathDirectionNotes[i + 1];
                var pa = nodePositions[i];
                var pb = nodePositions[i + 1];

                if (a.PathBeat <= pathBeat && pathBeat <= b.PathBeat && b.PathBeat != a.PathBeat)
                {
                    var interp = (pathBeat - a.PathBeat) / (b.PathBeat - a.PathBeat);
                    return new Point(
                        pa.X + (pb.X - pa.X) * interp,
                        pa.Y + (pb.Y - pa.Y) * interp
                    );
                }
            }
            return null;
        }

        private string FormatTime(double seconds)
        {
            var minutes = (int)(seconds / 60);
            var secs = (int)(seconds % 60);
            var ms = (int)((seconds * 1000) % 1000 / 10);
            return $"{minutes:D2}:{secs:D2}:{ms:D2}";
        }

        private bool IsMacOS()
        {
            return Environment.OSVersion.Platform == PlatformID.MacOSX;
        }

        private async void PlayNoteSound(string noteType)
        {
            try
            {
                if (tabSoundPlayer != null && sfxVolume > 0)
                {
                    // 비동기로 효과음 재생
                    await Task.Run(() =>
                    {
                        try
                        {
                            tabSoundPlayer.Play();
                        }
                        catch
                        {
                            // 효과음 재생 실패시 무시
                        }
                    });
                }
                else
                {
                    // 백업 사운드도 비동기로
                    await Task.Run(() => SystemSounds.Beep.Play());
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"효과음 재생 실패: {ex.Message}");
            }
        }

        // 설정 변경시 호출
        private void SettingsChanged(object sender, EventArgs e)
        {
            try
            {
                if (!double.TryParse(BpmTextBox.Text, out _) ||
                    !int.TryParse(PreDelayTextBox.Text, out _) ||
                    SubdivisionsComboBox.SelectedItem == null)
                {
                    return;
                }

                SaveToStorage();
                MarkNeedsRedraw(); // DrawPath() 대신

                foreach (var note in notes)
                {
                    note.OnPropertyChanged(nameof(note.TimeDisplay));
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"설정 변경 처리 실패: {ex.Message}");
            }
        }

        // 전체 다시 그리기가 필요한 경우들
        private void MarkNeedsRedraw()
        {
            needsFullRedraw = true;
        }


        #endregion

        #region Event Handlers

        private void MainCanvas_MouseWheel(object sender, MouseWheelEventArgs e)
        {
            System.Diagnostics.Debug.WriteLine($"MouseWheel: Delta={e.Delta}");
            e.Handled = true;

            var delta = e.Delta > 0 ? 1.1 : 0.9;
            var mousePos = e.GetPosition(MainCanvas);
            var worldX = (mousePos.X - viewOffset.X) / zoom;
            var worldY = (mousePos.Y - viewOffset.Y) / zoom;

            var oldZoom = zoom;
            zoom = Math.Max(1, Math.Min(200, zoom * delta));
            viewOffset.X = mousePos.X - worldX * zoom;
            viewOffset.Y = mousePos.Y - worldY * zoom;

            System.Diagnostics.Debug.WriteLine($"Zoom changed: {oldZoom:F2} -> {zoom:F2}");
            System.Diagnostics.Debug.WriteLine($"ViewOffset: X={viewOffset.X:F1}, Y={viewOffset.Y:F1}");

            DrawPath();
        }

        private void MainCanvas_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            System.Diagnostics.Debug.WriteLine("MouseLeftButtonDown");
            isPanning = true;
            lastMousePos = e.GetPosition(MainCanvas);
            MainCanvas.CaptureMouse();
            e.Handled = true;
        }

        private void MainCanvas_MouseMove(object sender, MouseEventArgs e)
        {
            if (isPanning && e.LeftButton == MouseButtonState.Pressed)
            {
                var currentPos = e.GetPosition(MainCanvas);
                var delta = currentPos - lastMousePos;
                viewOffset.X += delta.X;
                viewOffset.Y += delta.Y;
                lastMousePos = currentPos;

                System.Diagnostics.Debug.WriteLine($"Panning: ViewOffset X={viewOffset.X:F1}, Y={viewOffset.Y:F1}");
                DrawPath();
                e.Handled = true;
            }
        }

        private void MainCanvas_MouseLeftButtonUp(object sender, MouseButtonEventArgs e)
        {
            System.Diagnostics.Debug.WriteLine("MouseLeftButtonUp");
            if (isPanning)
            {
                isPanning = false;
                MainCanvas.ReleaseMouseCapture();
                e.Handled = true;
            }
        }

        private void MainCanvas_MouseRightButtonDown(object sender, MouseButtonEventArgs e)
        {
            // 노트 클릭 감지 및 포커스
            var clickPos = e.GetPosition(MainCanvas);
            FocusNoteAtPosition(clickPos);
        }

        private void FocusNoteAtPosition(Point clickPos)
        {
            var bpm = GetBpm();
            var subdivisions = GetSubdivisions();

            for (int i = 0; i < notes.Count; i++)
            {
                var pos = GetNotePosition(notes[i].Beat);
                if (!pos.HasValue) continue;

                var screenX = pos.Value.X * zoom + viewOffset.X;
                var screenY = pos.Value.Y * zoom + viewOffset.Y;
                var distance = Math.Sqrt(Math.Pow(screenX - clickPos.X, 2) + Math.Pow(screenY - clickPos.Y, 2));

                if (distance < 10)
                {
                    FocusNoteAtIndex(i);
                    break;
                }
            }
        }

        private Point? GetNotePosition(int beat)
        {
            var bpm = GetBpm();
            var subdivisions = GetSubdivisions();
            var preDelaySeconds = GetPreDelaySeconds(this);

            var pathBeat = beat;
            var directionNotes = notes.Where(n => n.Type == "direction").OrderBy(n => n.Beat).ToList();
            var pathDirectionNotes = directionNotes.Select((note, index) =>
            {
                double noteBeat;
                if (note.Beat == 0 && note.Type == "direction")
                {
                    noteBeat = 0;
                }
                else
                {
                    var originalTime = BeatToTime(note.Beat, bpm, subdivisions);
                    var adjustedTime = originalTime + preDelaySeconds;
                    noteBeat = TimeToBeat(adjustedTime, bpm, subdivisions);
                }
                return new { Note = note, PathBeat = noteBeat };
            }).OrderBy(x => x.PathBeat).ToList();

            var pos = new Point(0, 0);
            var nodePositions = new List<Point> { pos };

            for (int i = 0; i < pathDirectionNotes.Count - 1; i++)
            {
                var a = pathDirectionNotes[i];
                var b = pathDirectionNotes[i + 1];
                var dBeat = b.PathBeat - a.PathBeat;
                var dist = (8 * dBeat) / subdivisions;
                var direction = DirectionToVector(a.Note.Direction);
                var mag = Math.Sqrt(direction.X * direction.X + direction.Y * direction.Y);
                if (mag == 0) mag = 1;

                var next = new Point(pos.X + (direction.X / mag) * dist, pos.Y + (direction.Y / mag) * dist);

                if (a.PathBeat <= pathBeat && pathBeat <= b.PathBeat)
                {
                    var interp = (pathBeat - a.PathBeat) / (b.PathBeat - a.PathBeat);
                    return new Point(pos.X + (next.X - pos.X) * interp, pos.Y + (next.Y - pos.Y) * interp);
                }

                pos = next;
                nodePositions.Add(pos);
            }
            return null;
        }

        private void FocusNoteAtIndex(int index)
        {
            if (index < 0 || index >= notes.Count) return;

            var note = notes[index];
            var pos = GetNotePosition(note.Beat);
            if (!pos.HasValue) return;

            viewOffset.X = MainCanvas.ActualWidth / 2 - pos.Value.X * zoom;
            viewOffset.Y = MainCanvas.ActualHeight / 2 - pos.Value.Y * zoom;

            DrawPath();

            // 하이라이트 효과
            highlightedNoteIndex = index;
            highlightedNoteTimer = 0.5;

            if (!animationTimer.IsEnabled)
            {
                animationTimer.Start();
            }

            // DataGrid에서 해당 행 선택
            NoteListDataGrid.SelectedIndex = index;
            NoteListDataGrid.ScrollIntoView(notes[index]);
        }

        #endregion

        #region Playback Control

        private void PlayButton_Click(object sender, RoutedEventArgs e)
        {
            if (string.IsNullOrEmpty(audioFilePath)) return;

            if (isPaused)
            {
                isPaused = false;
                startTime = DateTime.Now.AddSeconds(-elapsedTime);
                mediaPlayer.Position = TimeSpan.FromSeconds(Math.Max(0, elapsedTime - MUSIC_START_TIME));
                mediaPlayer.Play();
                playbackTimer.Start();
            }
            else if (!isPlaying)
            {
                StartDemo();
            }
        }

        private void PauseButton_Click(object sender, RoutedEventArgs e)
        {
            if (!isPlaying) return;

            isPaused = !isPaused;
            if (isPaused)
            {
                mediaPlayer.Pause();
                playbackTimer.Stop();
            }
            else
            {
                startTime = DateTime.Now.AddSeconds(-elapsedTime);
                mediaPlayer.Play();
                playbackTimer.Start();
            }
        }

        private void StopButton_Click(object sender, RoutedEventArgs e)
        {
            if (!isPlaying) return;

            isPlaying = false;
            isPaused = false;
            elapsedTime = 0;
            mediaPlayer.Stop();
            playbackTimer.Stop();

            TimeDisplay.Text = "00:00:00 / 00:00:00";
            TimeDisplay2.Text = "00:00:00 / 00:00:00";
            SeekBar.Value = 0;
            SeekBar2.Value = 0;

            demoPlayerPosition = new Point(0, 0);
            playedNotes.Clear();

            DrawPath();
        }

        private void StartDemo()
        {
            isPlaying = true;
            isPaused = false;
            elapsedTime = 0;
            startTime = DateTime.Now;
            playedNotes.Clear();

            playbackTimer.Start();

            // 3초 후 음악 시작
            var musicStartTimer = new DispatcherTimer();
            musicStartTimer.Interval = TimeSpan.FromSeconds(MUSIC_START_TIME);
            musicStartTimer.Tick += (s, e) =>
            {
                if (!isPaused && isPlaying)
                {
                    mediaPlayer.Position = TimeSpan.Zero;
                    mediaPlayer.Play();
                }
                musicStartTimer.Stop();
            };
            musicStartTimer.Start();
        }

        private void RecalculatePathCache()
        {
            var bpm = GetBpm();
            var subdivisions = GetSubdivisions();
            var preDelaySeconds = GetPreDelaySeconds(this);

            var directionNotes = notes.Where(n => n.Type == "direction").OrderBy(n => n.Beat).ToList();
            cachedPathDirectionNotes = directionNotes.Select((note, index) =>
            {
                double pathBeat;
                if (note.Beat == 0 && note.Type == "direction")
                {
                    pathBeat = 0;
                }
                else
                {
                    var originalTime = BeatToTime(note.Beat, bpm, subdivisions);
                    var adjustedTime = originalTime + preDelaySeconds;
                    pathBeat = TimeToBeat(adjustedTime, bpm, subdivisions);
                }
                return new { Note = note, PathBeat = pathBeat };
            }).Cast<dynamic>().ToList();

            cachedNodePositions = new List<Point>();
            var pos = new Point(0, 0);
            cachedNodePositions.Add(pos);

            for (int i = 0; i < cachedPathDirectionNotes.Count - 1; i++)
            {
                var a = cachedPathDirectionNotes[i];
                var b = cachedPathDirectionNotes[i + 1];
                var dBeat = b.PathBeat - a.PathBeat;
                var dist = (8 * dBeat) / subdivisions;
                var direction = DirectionToVector(a.Note.Direction);
                var mag = Math.Sqrt(direction.X * direction.X + direction.Y * direction.Y);
                if (mag == 0) mag = 1;

                var next = new Point(pos.X + (direction.X / mag) * dist, pos.Y + (direction.Y / mag) * dist);
                pos = next;
                cachedNodePositions.Add(pos);
            }

            pathCacheValid = true;
        }

        private void PlaybackTimer_Tick(object sender, EventArgs e)
        {
            if (!isPlaying || isPaused) return;

            var stopwatch = System.Diagnostics.Stopwatch.StartNew();

            elapsedTime = (DateTime.Now - startTime).TotalSeconds;
            var bpm = GetBpm();
            var subdivisions = GetSubdivisions();
            var preDelaySeconds = GetPreDelaySeconds(this);

            var currentBeat = TimeToBeat(elapsedTime, bpm, subdivisions);

            stopwatch.Stop();
            var setupTime = stopwatch.ElapsedMilliseconds;

            // 노트 히트 체크 성능 측정
            stopwatch.Restart();
            CheckNoteHits(elapsedTime);
            stopwatch.Stop();
            var noteHitTime = stopwatch.ElapsedMilliseconds;

            // UI 업데이트 성능 측정
            stopwatch.Restart();
            UpdateUI();
            stopwatch.Stop();
            var uiTime = stopwatch.ElapsedMilliseconds;

            // 플레이어 위치 업데이트 성능 측정
            stopwatch.Restart();
            UpdateDemoPlayerPosition(currentBeat);
            stopwatch.Stop();
            var playerTime = stopwatch.ElapsedMilliseconds;

            // 시각적 업데이트 성능 측정
            stopwatch.Restart();
            UpdatePlayerVisual();
            stopwatch.Stop();
            var visualTime = stopwatch.ElapsedMilliseconds;

            var totalTime = setupTime + noteHitTime + uiTime + playerTime + visualTime;
            if (totalTime > 10) // 10ms 이상이면 로그
            {
                System.Diagnostics.Debug.WriteLine($"Performance: Setup={setupTime}ms, NoteHit={noteHitTime}ms, UI={uiTime}ms, Player={playerTime}ms, Visual={visualTime}ms, Total={totalTime}ms");
            }
        }

        private int uiUpdateCounter = 0;

        private void UpdateUI()
        {
            // UI는 3프레임마다 한 번씩만 업데이트 (30fps -> 10fps)
            uiUpdateCounter++;
            if (uiUpdateCounter % 3 != 0) return;

            var preDelaySeconds = GetPreDelaySeconds(this);
            if (audioDuration > 0)
            {
                var totalTime = audioDuration + preDelaySeconds;
                TimeDisplay.Text = $"{FormatTime(elapsedTime)} / {FormatTime(totalTime)}";
                TimeDisplay2.Text = $"{FormatTime(elapsedTime)} / {FormatTime(totalTime)}";
                SeekBar.Maximum = totalTime * 1000;
                SeekBar.Value = elapsedTime * 1000;
                SeekBar2.Maximum = totalTime * 1000;
                SeekBar2.Value = elapsedTime * 1000;
            }
        }

        private void CheckNoteHits(double currentTime)
        {
            var bpm = GetBpm();
            var subdivisions = GetSubdivisions();
            var preDelaySeconds = GetPreDelaySeconds(this);

            const double tolerance = 0.05;
            const double checkWindow = 0.1; // 현재 시간 ±0.1초 범위만 체크

            // 전체 노트를 매번 순회하는 대신 시간 범위로 필터링
            var relevantNotes = notes.Where((note, index) =>
            {
                var noteId = $"{note.Type}-{note.Beat}-{index}";
                if (playedNotes.Contains(noteId)) return false;

                double targetTime;
                if (note.Beat == 0 && note.Type == "direction")
                {
                    targetTime = 0;
                }
                else
                {
                    var originalTime = BeatToTime(note.Beat, bpm, subdivisions);
                    targetTime = originalTime + preDelaySeconds;
                }

                // 시간 범위 체크로 미리 필터링
                return Math.Abs(currentTime - targetTime) <= checkWindow;
            }).Select((note, index) => new { Note = note, Index = index });

            foreach (var item in relevantNotes)
            {
                var noteId = $"{item.Note.Type}-{item.Note.Beat}-{item.Index}";

                double targetTime;
                if (item.Note.Beat == 0 && item.Note.Type == "direction")
                {
                    targetTime = 0;
                    if (currentTime >= targetTime - tolerance && currentTime <= targetTime + tolerance)
                    {
                        playedNotes.Add(noteId);
                        HighlightNoteHit(item.Index);
                    }
                    continue;
                }
                else
                {
                    var originalTime = BeatToTime(item.Note.Beat, bpm, subdivisions);
                    targetTime = originalTime + preDelaySeconds;
                }

                if (currentTime >= targetTime - tolerance && currentTime <= targetTime + tolerance)
                {
                    PlayNoteSound(item.Note.Type);
                    playedNotes.Add(noteId);
                    HighlightNoteHit(item.Index);
                }
            }
        }

        private void HighlightNoteHit(int noteIndex)
        {
            highlightedNoteIndex = noteIndex;
            highlightedNoteTimer = 0.3;

            if (!animationTimer.IsEnabled)
            {
                animationTimer.Start();
            }
        }
        private List<dynamic> cachedPathDirectionNotes;
        private List<Point> cachedNodePositions;
        private bool pathCacheValid = false;

        private void InvalidatePathCache()
        {
            pathCacheValid = false;
        }

        private void UpdateDemoPlayerPosition(int currentBeat)
        {
            // 캐시가 유효하지 않으면 다시 계산
            if (!pathCacheValid)
            {
                RecalculatePathCache();
            }

            // 캐시된 데이터로 플레이어 위치 계산
            if (cachedPathDirectionNotes.Count >= 2)
            {
                for (int i = 1; i < cachedPathDirectionNotes.Count; i++)
                {
                    var a = cachedPathDirectionNotes[i - 1];
                    var b = cachedPathDirectionNotes[i];
                    var pa = cachedNodePositions[i - 1];
                    var pb = cachedNodePositions[i];

                    if (currentBeat >= a.PathBeat && currentBeat <= b.PathBeat)
                    {
                        var t = (currentBeat - a.PathBeat) / (b.PathBeat - a.PathBeat);
                        demoPlayerPosition.X = pa.X + (pb.X - pa.X) * t;
                        demoPlayerPosition.Y = pa.Y + (pb.Y - pa.Y) * t;
                        break;
                    }
                }
            }
        }

        private void SeekBar_ValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
        {
            if (!isPlaying) return;

            elapsedTime = e.NewValue / 1000.0;
            startTime = DateTime.Now.AddSeconds(-elapsedTime);

            playedNotes.Clear();

            var preDelaySeconds = GetPreDelaySeconds(this);
            if (elapsedTime < MUSIC_START_TIME)
            {
                mediaPlayer.Pause();
                mediaPlayer.Position = TimeSpan.Zero;
            }
            else
            {
                mediaPlayer.Position = TimeSpan.FromSeconds(Math.Max(0, elapsedTime - MUSIC_START_TIME));
                if (!isPaused)
                {
                    mediaPlayer.Play();
                }
            }
            DrawPath();
        }

        private void AnimationTimer_Tick(object sender, EventArgs e)
        {
            bool needsRedraw = false;

            if (highlightedNoteTimer > 0)
            {
                highlightedNoteTimer -= 1.0 / 60.0;
                if (highlightedNoteTimer <= 0)
                {
                    highlightedNoteTimer = 0;
                    highlightedNoteIndex = -1;
                }
                needsRedraw = true;
            }

            if (pathHighlightTimer > 0)
            {
                pathHighlightTimer -= 1.0 / 60.0;
                if (pathHighlightTimer <= 0)
                {
                    pathHighlightTimer = 0;
                }
                needsRedraw = true;
            }

            if (needsRedraw)
            {
                DrawPath();
            }
            else
            {
                animationTimer.Stop();
            }
        }

        #endregion

        #region Audio and File Operations

        private void SelectAudioFile_Click(object sender, RoutedEventArgs e)
        {
            var openFileDialog = new OpenFileDialog
            {
                Filter = "Audio files (*.mp3;*.wav;*.wma)|*.mp3;*.wav;*.wma|All files (*.*)|*.*",
                Title = "오디오 파일 선택"
            };

            if (openFileDialog.ShowDialog() == true)
            {
                audioFilePath = openFileDialog.FileName;
                var fileInfo = new FileInfo(audioFilePath);
                audioFileSize = fileInfo.Length;

                mediaPlayer.Open(new Uri(audioFilePath));
                mediaPlayer.Volume = musicVolume;

                AudioFileIndicator.Text = $"선택된 파일: {fileInfo.Name}";
                hasAudioFile = true;

                // 오디오 길이 가져오기 (비동기로 처리)
                Task.Run(() =>
                {
                    var player = new MediaPlayer();
                    player.Open(new Uri(audioFilePath));

                    player.MediaOpened += (s, args) =>
                    {
                        Dispatcher.Invoke(() =>
                        {
                            if (player.NaturalDuration.HasTimeSpan)
                            {
                                audioDuration = player.NaturalDuration.TimeSpan.TotalSeconds;
                            }
                            player.Close();
                        });
                    };
                });

                SaveToStorage();
            }
        }

        private void SaveJson_Click(object sender, RoutedEventArgs e)
        {
            var saveFileDialog = new SaveFileDialog
            {
                Filter = "JSON files (*.json)|*.json|All files (*.*)|*.*",
                FileName = "wl_chart.json"
            };

            if (saveFileDialog.ShowDialog() == true)
            {
                var bpm = GetBpm();
                var subdivisions = GetSubdivisions();
                var preDelayValue = int.Parse(PreDelayTextBox.Text);
                var windowsPreDelay = IsMacOS() ? preDelayValue - MAC_DELAY_OFFSET : preDelayValue;
                var preDelaySeconds = windowsPreDelay / 1000.0;

                var exportData = new
                {
                    diffIndex = 5,
                    level = 10,
                    bpm = bpm,
                    subdivisions = subdivisions,
                    preDelay = windowsPreDelay,
                    noteList = notes.Select(n =>
                    {
                        var originalTime = BeatToTime(n.Beat, bpm, subdivisions);
                        var finalTime = n.Beat == 0 && n.Type == "direction" ? originalTime : originalTime + preDelaySeconds;

                        return new
                        {
                            beat = n.Beat,
                            originalTime = originalTime,
                            musicTime = MUSIC_START_TIME + originalTime,
                            finalTime = finalTime,
                            isLong = false,
                            longTime = 0.0,
                            noteType = n.Type == "direction" ? "Direction" : "Tab",
                            direction = n.Direction ?? "none"
                        };
                    }).ToArray(),
                    metadata = new
                    {
                        description = "WL Editor chart file with music timing",
                        timingExplanation = "finalTime = 3.0 + originalTime + preDelay (except for beat 0 direction note)",
                        exportedAt = DateTime.Now.ToString("O")
                    }
                };

                var json = JsonSerializer.Serialize(exportData, new JsonSerializerOptions { WriteIndented = true });
                File.WriteAllText(saveFileDialog.FileName, json);
            }
        }

        private void LoadJson_Click(object sender, RoutedEventArgs e)
        {
            var openFileDialog = new OpenFileDialog
            {
                Filter = "JSON files (*.json)|*.json|All files (*.*)|*.*"
            };

            if (openFileDialog.ShowDialog() == true)
            {
                try
                {
                    var json = File.ReadAllText(openFileDialog.FileName);

                    // JSON 파싱을 위한 간단한 구현
                    // 실제 구현에서는 적절한 모델 클래스를 만들어 사용하세요
                    using var document = JsonDocument.Parse(json);
                    var root = document.RootElement;

                    if (root.TryGetProperty("bpm", out var bpmElement))
                    {
                        BpmTextBox.Text = bpmElement.GetDouble().ToString();
                    }

                    if (root.TryGetProperty("subdivisions", out var subdivElement))
                    {
                        var subdivValue = subdivElement.GetInt32().ToString();
                        foreach (ComboBoxItem item in SubdivisionsComboBox.Items)
                        {
                            if (item.Tag.ToString() == subdivValue)
                            {
                                SubdivisionsComboBox.SelectedItem = item;
                                break;
                            }
                        }
                    }

                    if (root.TryGetProperty("preDelay", out var preDelayElement))
                    {
                        var windowsPreDelay = preDelayElement.GetInt32();
                        var macPreDelay = IsMacOS() ? windowsPreDelay + MAC_DELAY_OFFSET : windowsPreDelay;
                        PreDelayTextBox.Text = macPreDelay.ToString();
                    }

                    if (root.TryGetProperty("noteList", out var noteListElement))
                    {
                        notes.Clear();

                        foreach (var noteElement in noteListElement.EnumerateArray())
                        {
                            var note = new Note();

                            if (noteElement.TryGetProperty("beat", out var beatElement))
                                note.Beat = beatElement.GetInt32();

                            if (noteElement.TryGetProperty("noteType", out var typeElement))
                                note.Type = typeElement.GetString() == "Direction" ? "direction" : "tab";

                            if (noteElement.TryGetProperty("direction", out var dirElement))
                                note.Direction = dirElement.GetString() ?? "none";

                            notes.Add(note);
                        }

                        UpdateNoteIndices();
                    }

                    SaveToStorage();
                    DrawPath();

                    MessageBox.Show("JSON 파일을 성공적으로 불러왔습니다.", "성공", MessageBoxButton.OK, MessageBoxImage.Information);
                }
                catch (Exception ex)
                {
                    MessageBox.Show($"불러오기 중 오류 발생: {ex.Message}", "오류", MessageBoxButton.OK, MessageBoxImage.Error);
                }
            }
        }

        private void SaveToStorage()
        {
            try
            {
                var appDataPath = IOPath.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "WL_Editor");
                Directory.CreateDirectory(appDataPath);

                var autoSaveData = new
                {
                    notes = notes.ToList(),
                    audioFileName = string.IsNullOrEmpty(audioFilePath) ? null : IOPath.GetFileName(audioFilePath),
                    audioFileSize = audioFileSize,
                    preDelay = int.Parse(PreDelayTextBox.Text),
                    bpm = GetBpm(),
                    subdivisions = GetSubdivisions()
                };

                var json = JsonSerializer.Serialize(autoSaveData, new JsonSerializerOptions { WriteIndented = true });
                File.WriteAllText(IOPath.Combine(appDataPath, "autosave.json"), json);
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"자동 저장 실패: {ex.Message}");
            }
        }

        private void LoadFromStorage()
        {
            try
            {
                var appDataPath = IOPath.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "WL_Editor");
                var autoSaveFile = IOPath.Combine(appDataPath, "autosave.json");

                if (File.Exists(autoSaveFile))
                {
                    var json = File.ReadAllText(autoSaveFile);
                    using var document = JsonDocument.Parse(json);
                    var root = document.RootElement;

                    // BPM 복원
                    if (root.TryGetProperty("bpm", out var bpmElement))
                    {
                        BpmTextBox.Text = bpmElement.GetDouble().ToString();
                    }

                    // Subdivisions 복원
                    if (root.TryGetProperty("subdivisions", out var subdivElement))
                    {
                        var subdivValue = subdivElement.GetInt32().ToString();
                        foreach (ComboBoxItem item in SubdivisionsComboBox.Items)
                        {
                            if (item.Tag.ToString() == subdivValue)
                            {
                                SubdivisionsComboBox.SelectedItem = item;
                                break;
                            }
                        }
                    }

                    // Pre-delay 복원
                    if (root.TryGetProperty("preDelay", out var preDelayElement))
                    {
                        PreDelayTextBox.Text = preDelayElement.GetInt32().ToString();
                    }

                    // 오디오 파일 정보 복원
                    if (root.TryGetProperty("audioFileName", out var audioFileElement) && !audioFileElement.ValueKind.Equals(JsonValueKind.Null))
                    {
                        var fileName = audioFileElement.GetString();
                        AudioFileIndicator.Text = $"이전 파일: {fileName} (다시 선택 필요)";
                    }

                    // 노트 데이터 복원
                    if (root.TryGetProperty("notes", out var notesElement))
                    {
                        notes.Clear();

                        foreach (var noteElement in notesElement.EnumerateArray())
                        {
                            var note = new Note();

                            if (noteElement.TryGetProperty("Type", out var typeElement))
                                note.Type = typeElement.GetString();

                            if (noteElement.TryGetProperty("Beat", out var beatElement))
                                note.Beat = beatElement.GetInt32();

                            if (noteElement.TryGetProperty("Direction", out var dirElement))
                                note.Direction = dirElement.GetString() ?? "none";

                            notes.Add(note);
                        }

                        UpdateNoteIndices();
                    }
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"자동 로드 실패: {ex.Message}");
            }
        }

        #endregion

        #region Note Management

        private void AddTabNote_Click(object sender, RoutedEventArgs e)
        {
            var subdivisions = GetSubdivisions();
            var maxBeat = notes.Count > 0 ? notes.Max(n => n.Beat) : 0;

            notes.Add(new Note
            {
                Type = "tab",
                Beat = maxBeat + subdivisions
            });

            UpdateNoteIndices();
            SaveToStorage();
            DrawPath();
        }

        private void AddDirectionNote_Click(object sender, RoutedEventArgs e)
        {
            var subdivisions = GetSubdivisions();
            var directionNotes = notes.Where(n => n.Type == "direction").ToList();
            var maxDir = directionNotes.LastOrDefault();
            var newBeat = (maxDir?.Beat ?? 0) + subdivisions;
            var inheritedDirection = maxDir?.Direction ?? "none";

            notes.Add(new Note
            {
                Type = "direction",
                Beat = newBeat,
                Direction = inheritedDirection
            });

            UpdateNoteIndices();
            SaveToStorage();
            DrawPath();
        }

        private void DeleteNote_Click(object sender, RoutedEventArgs e)
        {
            var button = sender as Button;
            var note = button?.DataContext as Note;
            if (note != null && !(note.Beat == 0 && note.Type == "direction"))
            {
                notes.Remove(note);
                UpdateNoteIndices();
                SaveToStorage();
                DrawPath();
            }
        }

        private void SortNotes_Click(object sender, RoutedEventArgs e)
        {
            var sortedNotes = notes.OrderBy(n => n.Beat).ToList();
            notes.Clear();
            foreach (var note in sortedNotes)
            {
                notes.Add(note);
            }
            UpdateNoteIndices();
            SaveToStorage();
            DrawPath();
        }

        private void ClearAll_Click(object sender, RoutedEventArgs e)
        {
            if (MessageBox.Show("모든 데이터를 삭제하시겠습니까?", "확인", MessageBoxButton.YesNo, MessageBoxImage.Question) == MessageBoxResult.Yes)
            {
                notes.Clear();
                EnsureInitialDirectionNote();
                DrawPath();
                SaveToStorage();
            }
        }

        #endregion

        #region UI Controls

        private void SidebarToggle_Click(object sender, RoutedEventArgs e)
        {
            var isHidden = SidebarColumn.Width.Value == 0;

            if (isHidden)
            {
                SidebarColumn.Width = new GridLength(400);
                SidebarToggleButton.Content = "◀";
                WaveformContainer.Margin = new Thickness(400, 0, 0, 0);
            }
            else
            {
                SidebarColumn.Width = new GridLength(0);
                SidebarToggleButton.Content = "▶";
                WaveformContainer.Margin = new Thickness(0, 0, 0, 0);
            }

            Task.Delay(300).ContinueWith(_ =>
            {
                Dispatcher.Invoke(() =>
                {
                    ResizeCanvas();
                    DrawPath();
                });
            });
        }

        private void ControlPanelToggle_Click(object sender, RoutedEventArgs e)
        {
            ControlPanel.Visibility = ControlPanel.Visibility == Visibility.Visible ?
                Visibility.Collapsed : Visibility.Visible;

            ControlPanelToggleButton.Content = ControlPanel.Visibility == Visibility.Visible ? "×" : "⚙";
        }

        private void MusicVolumeSlider_ValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
        {
            musicVolume = e.NewValue / 100.0;

            // null 체크 추가
            if (mediaPlayer != null)
            {
                mediaPlayer.Volume = musicVolume;
            }

            // null 체크 추가
            if (MusicVolumeLabel != null)
            {
                MusicVolumeLabel.Content = $"{(int)e.NewValue}%";
            }
        }

        private void SfxVolumeSlider_ValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
        {
            sfxVolume = e.NewValue / 100.0;

            // null 체크 추가
            if (SfxVolumeLabel != null)
            {
                SfxVolumeLabel.Content = $"{(int)e.NewValue}%";
            }
        }

        #endregion

        #region Waveform (Placeholder)

        private void WaveformZoomIn_Click(object sender, RoutedEventArgs e)
        {
            waveformZoom = Math.Min(waveformZoom * 2, 16);
            WaveformZoomLabel.Content = $"{(int)(waveformZoom * 100)}%";
            // 실제 웨이브폼 그리기 구현 필요
        }

        private void WaveformZoomOut_Click(object sender, RoutedEventArgs e)
        {
            waveformZoom = Math.Max(waveformZoom / 2, 0.25);
            WaveformZoomLabel.Content = $"{(int)(waveformZoom * 100)}%";
            // 실제 웨이브폼 그리기 구현 필요
        }

        private void WaveformReset_Click(object sender, RoutedEventArgs e)
        {
            waveformZoom = 1.0;
            waveformOffset = 0;
            WaveformZoomLabel.Content = "100%";
            // 실제 웨이브폼 그리기 구현 필요
        }

        private void WaveformCanvas_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            if (!hasAudioFile) return;

            var clickPos = e.GetPosition(WaveformCanvas);
            // 웨이브폼 클릭 처리 구현 필요
            pathHighlightTimer = 1.0;

            if (!animationTimer.IsEnabled)
            {
                animationTimer.Start();
            }
        }

        private void WaveformCanvas_MouseWheel(object sender, MouseWheelEventArgs e)
        {
            // 웨이브폼 줌 처리 구현 필요
        }

        private void WaveformSlider_ValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
        {
            // 웨이브폼 스크롤 처리 구현 필요
        }

        private Ellipse playerVisual;
        private bool needsFullRedraw = false;

        private void UpdatePlayerVisual()
        {
            if (needsFullRedraw)
            {
                DrawPath();
                needsFullRedraw = false;
                return;
            }

            // 기존 플레이어 제거
            if (playerVisual != null)
            {
                MainCanvas.Children.Remove(playerVisual);
            }

            // 플레이어만 다시 그리기
            if (isPlaying)
            {
                var screenX = demoPlayerPosition.X * zoom + viewOffset.X;
                var screenY = demoPlayerPosition.Y * zoom + viewOffset.Y;

                playerVisual = new Ellipse
                {
                    Width = 20,
                    Height = 20,
                    Fill = Brushes.Blue,
                    Stroke = Brushes.White,
                    StrokeThickness = 2
                };

                Canvas.SetLeft(playerVisual, screenX - 10);
                Canvas.SetTop(playerVisual, screenY - 10);
                Canvas.SetZIndex(playerVisual, 1000); // 최상위에 표시
                MainCanvas.Children.Add(playerVisual);
            }
        }

        #endregion
    }
}